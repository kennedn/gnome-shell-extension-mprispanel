"use strict";

const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const PointerWatcher = imports.ui.pointerWatcher.getPointerWatcher();
const Clutter = imports.gi.Clutter;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const introspection = {};
introspection.DBus = Me.imports.dbus.DBus.Introspection;
introspection.MPRIS = Me.imports.dbus.MPRIS.Introspection;
let widgetController;

function init() {}

function enable() {
    widgetController = new MPRISController(introspection.DBus, introspection.MPRIS, 
                                           "org.freedesktop.DBus", "/org/freedesktop/DBus");
    widgetController.enable();
}

function disable() {
    widgetController.remove();
    widgetController = null;
}

// Base class defines a connection to a DBus interface via proxy
class DBusProxy {
    constructor(introspect, busInterface, busPath) {
        this.introspect = introspect;
        this.proxy = null;
        this.busInterface = busInterface;
        this.busPath = busPath;
        this.connections = [];
    }

    // Create a proxy object connecting to a remote DBus interface
    connect() {
        let dbusWrapper = Gio.DBusProxy.makeProxyWrapper(this.introspect);
        try {this.proxy = new dbusWrapper(Gio.DBus.session, this.busInterface, this.busPath);} 
        catch (e) {logError(e);}
    }

    // Disconnect stored connection, with optional type param to disconnect a subset of connections
    remove(type=null) {
        this.connections.forEach((conn, idx, obj) => {
            if (type === null || conn.type === type) {
                conn.object.disconnect(conn.handler);
                obj.splice(idx, 1);
            }
        });
    }

    // Convenience function to shorten binds
    _bind(func) {
        return func.bind(this);
    }

    // Obj.connect wrapper that stores type, handler and object for later disconnect
    _storeConnection(type, object, property, callback) {
        this.connections.push({"type": type, "object": object, "handler": object.connect(property, callback)});
    }
}


// Possible widget states
const widgetState = Object.freeze({
    ENABLED: 1,
    DISABLED: 2,
    REMOVED: 3,
    ANIMATING: 4,
});

// Defines a controller class that manages a child widget based on MPRIS interfaces availabe on DBus
class MPRISController extends DBusProxy {
    constructor(dbusIntrospect, mprisIntrospect, busInterface, busPath) {
        super(dbusIntrospect, busInterface, busPath);
        this.widget = null;
        this.mprisIntrospect = mprisIntrospect;
        this.widgetBusInterface = null;
        this.state = widgetState.DISABLED;

        // Create a SchemaSource object so that we can search for our extensions schema
        let gschema = Gio.SettingsSchemaSource.new_from_directory(
            Me.dir.get_child('schemas').get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        // Build a settings object from our extensions schema
        this.settings = new Gio.Settings({
            settings_schema: gschema.lookup('org.gnome.shell.extensions.mprispanel', true)
        });

        // Set gsettings derived variables to default settings and then attempt to parse gsettings
        this.detectedInterfaces = "";
        this.enabledInterfaces = [];
        this.whitelist = false;
        this._storeConnection('gsetting', this.settings, 'changed::enabled-interfaces', this._bind(this._parseSettings));
        this._storeConnection('gsetting', this.settings, 'changed::whitelist', this._bind(this._parseSettings));
        this._parseSettings();
    }

    // Callback for change to gsettings
    _parseSettings() {
        // Parse comma seperated gsettings string into an array of enabledInterfaces
        this.enabledInterfaces = this.settings.get_string('enabled-interfaces').split(',');
        // Get whitelist boolean from gsettings
        this.whitelist = this.settings.get_boolean('whitelist');
        // Set widgetBusInterface back to null to prompt _monitor() to recreate widget
        this.widgetBusInterface = null;
    }

    // Connect DBus proxy and start monitoring for MPRIS changes
    enable() {
        switch (this.state) {
            case widgetState.DISABLED:
                this.state = widgetState.ENABLED;
                this.connect();
                this._monitor();
                break;
        }
    }

    // Cleanly remove active widget and change state to REMOVED to break _monitor() loop;
    remove() {
        super.remove();
        this.state = widgetState.REMOVED;
        if (this.widget !== null) {this.widget.remove();}
        this.widget = null;
    }

    // Monitor periodically for changes to DBus interfaces and recreate the widget with new interface if required
    _monitor() {
        switch (this.state) {
            case widgetState.ENABLED:
                // Get the top MPRIS interface from array of possible interfaces
                let nextInterface = this._mprisInterface;
                // Check for valid interface, must differ from current interface
                if (nextInterface !== undefined && nextInterface !== this.widgetBusInterface) {
                    this.widgetBusInterface = nextInterface;
                    // Only bother to remove if the object exists
                    if (this.widget !== null) {this.widget.remove();}
                    // Create a new widget with nextInterface and connect its signals up
                    this.widget = new MPRISWidget(this.mprisIntrospect, this.widgetBusInterface, "/org/mpris/MediaPlayer2");
                    this.widget.connect();
                }
                // Run monitor again in 100ms
                GLib.timeout_add(0, 100, this._bind(this._monitor));
                break;
        }
    }

    // Get and parse a list of available MPRIS interfaces from DBus, return most 'preferred' interface
    get _mprisInterface() {
        let mprisInterfaces = this.proxy.ListNamesSync()[0].filter(v => v.includes("org.mpris.MediaPlayer2"));

        // Parse mpris interfaces into a readible list and store in gsettings for prefs.js to print
        let detectedInterfaces = mprisInterfaces.map(m => m.split(".")[3]).join(', ');
        if (this.detectedInterfaces !== detectedInterfaces) {
            this.detectedInterfaces = detectedInterfaces;
            this.settings.set_string('detected-interfaces', detectedInterfaces);
        }

        // Iterate over enabledInterfaces and return first available interface
        for(let e of this.enabledInterfaces) {
            let iface = mprisInterfaces.find(v => v.includes(e));
            if (iface !== undefined) {return iface;}
        }
        // If whitelist is false and at least one interface exists, return first leftover interface
        return (this.whitelist || mprisInterfaces.length < 1) ? undefined : mprisInterfaces[0];
    }
}

// Defines a widget that exposes MPRIS controls as buttons on the gnome panel
class MPRISWidget extends DBusProxy{
    constructor(introspect, busInterface, busPath) {
        super(introspect, busInterface, busPath);
        this.playbackStatus = "Paused";
        this.state = widgetState.DISABLED;

        // Collection of buttons that will be inserted and removed from the panel
        this.buttonContainer = new St.BoxLayout({ style_class: 'panel-status-menu-box', reactive: true,
                                                  can_focus: true, track_hover: true, vertical: false});

        // Create all required buttons, in the reverse order that they will appear in the panel
        this.buttons = {};
        this.buttons.forward = this._createContainerButton('media-skip-forward-symbolic', this.buttonContainer);
        this.buttons.start = this._createContainerButton('media-playback-start-symbolic', this.buttonContainer);
        this.buttons.pause = this._createContainerButton('media-playback-pause-symbolic', this.buttonContainer);
        this.buttons.backward = this._createContainerButton('media-skip-backward-symbolic', this.buttonContainer);

        // Hide pause so that we start with the play icon in center
        this.buttons.pause.hide();

        // Build a shorthand identifier label derived from busInterface string
        let labelText = this.busInterface.split(".")[3];
        // Capitalize text
        this.labelText = labelText[0].toUpperCase() + labelText.slice(1);
        this.label = new St.Label({style_class: 'panel-button', text: this.labelText,
                                   x_expand: true, x_align: Clutter.ActorAlign.CENTER,
                                   y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.mouseLabel = new St.Label({style_class: 'dash-label', text: this.labelText,
                                        x_expand: true, x_align: Clutter.ActorAlign.CENTER,
                                        y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        Main.layoutManager.addChrome(this.mouseLabel);

        this.buttonContainer.insert_child_at_index(this.label, 0);
        this.label.hide();

        this.mouseLabel.hide();

        // Animation constants
        this.startTime = 380;
        this.animTime = 100;
        this.waitTime = 150;
        this.mouseOverTime = 1600;
        this.mouseOverID = -1;
        this.mouseListener = null;
        // Older versions of gnome must rely on behaviour scaling for animations, newer versions can use easing
        this._animate = (typeof Clutter.BehaviourScale === 'function') ? 
                         this._bind(this._animateBscale) : 
                         this._bind(this._animateEase); 

    }


    // Attempts to establish a connection to MPRIS interface and connect buttons and callbacks up
    connect(update=true) {
        // Remove any previous dbus connections
        super.remove('dbus');
        // Connect this.proxy to MPRIS interface
        super.connect();
        // Attach callbacks for each button and to watch for property changes on the mpris interface
        this._storeConnection('dbus', this.buttons.start, 'button-press-event', this._bind(() => this.proxy.PlayRemote()));
        this._storeConnection('dbus', this.buttons.pause, 'button-press-event', this._bind(() => this.proxy.PauseRemote()));
        this._storeConnection('dbus', this.buttons.forward, 'button-press-event', this._bind(() => this.proxy.NextRemote()));
        this._storeConnection('dbus', this.buttons.backward, 'button-press-event', this._bind(() => this.proxy.PreviousRemote()));
        this._storeConnection('dbus', this.proxy, 'g-properties-changed', this._bind(this._update));
        this._storeConnection('mouse', this.buttonContainer, 'enter-event', this._bind(this._onEnter));

        // Call update once in case MPRIS player is already open.
        if (update) {this._update();}
    }

    _onEnter() {
        if (this.mouseOverID >= 0 || this.mouseListener) {return;} // Label is currently displaying
        log("_old_enter fired")
        this.mouseOverID = GLib.timeout_add(0, this.mouseOverTime, this._bind(() => { 
            this.mouseOverID = -1;
            if (!this._onMotion()) {return;}
            this.mouseListener = PointerWatcher.addWatch(20, this._bind(this._onMotion));
            this.mouseLabel.show();
        }));
    }   

    _onLeave() {
        this.mouseLabel.hide();
        log("mouseListener: " + this.mouseListener);
        if (this.mouseListener) {
            PointerWatcher._removeWatch(this.mouseListener);
            log("removed watch")
            this.mouseListener = null;
        }
        log("mouseListener: " + this.mouseListener);
        if (this.mouseOverID >= 0) { 
            GLib.Source.remove(this.mouseOverID); 
            this.mouseOverID = -1;
        }
    }

    _onMotion() {
        // Trigger leave event if mouse no longer in bounds of buttonContainer
        if (!this.buttonContainer.get_hover()) {
            this._onLeave();
            return false;
        }

        let [mouseX, mouseY, _] = global.get_pointer();

        let yOffset = this.mouseLabel.get_height() * 0.7;
        let xOffset = this.mouseLabel.get_width() * 0.1;
        let y = mouseY + yOffset;
        let x = mouseX + xOffset;

        this.mouseLabel.set_position(x, y);
        return true;
    }

    // Insert container onto panel
    enable() {
        switch (this.state) {
            case widgetState.DISABLED:
                Main.panel._rightBox.insert_child_at_index(this.buttonContainer, 0);
                //this._displayLabel();
                this.state = widgetState.ENABLED;
                break;
        }
    }

    // Remove container from panel
    disable() {
        switch (this.state) {
            case widgetState.ENABLED:
                Main.panel._rightBox.remove_child(this.buttonContainer);
                this.state = widgetState.DISABLED;
                break;
        }
    }

    // Run disable if still enabled, disconnect any callback connections and destroy the container
    remove() {
        super.remove();
        // Mark class instance as removed
        this.state = widgetState.REMOVED;
        if (this.buttonContainer in Main.panel._rightBox.get_children()) {
            Main.panel._rightBox.remove_child(this.buttonContainer);
        }
        Main.layoutManager.removeChrome(this.mouseLabel);
        // Destroy children and container
        this.buttonContainer.destroy();
    }

    _updateButtonsState(playbackStatus) {
        if(playbackStatus) {
            log("playbackStatus:" + playbackStatus);
            // Callback fires multiple times so check if PlaybackStatus is different from last time we fired.
            if(this.playbackStatus == playbackStatus) {return;}
            this.playbackStatus = playbackStatus;
        } 

        for(let b in this.buttons) {this.buttons[b].show();} 
        if(this.playbackStatus == "Playing") {this.buttons.start.hide();}
        else if(this.playbackStatus == "Paused" || this.playbackStatus == "Stopped") {this.buttons.pause.hide();}

        if (this.proxy.CanGoNext) {
            this.buttons.forward.opacity = 255;
        } else {
            this.buttons.forward.opacity = 64;
        }

        if (this.proxy.CanGoPrevious) {
            this.buttons.backward.opacity = 255;
        } else {
            this.buttons.backward.opacity = 64;
        }
    }

    // Modifies widget behavior based on MPRIS player's state
    _update() {
        switch(this.state) {
            case widgetState.ENABLED:
                // Restore widget to left most index in rightBox if container has moved
                if (Main.panel._rightBox.get_children()[0] != this.buttonContainer) {this.disable(); this.enable();}
                if (this._isRunning) {
                    this._updateButtonsState(this.proxy.PlaybackStatus); 
                } else {this.disable();} // The MPRIS player is no longer active
                break;
            case widgetState.DISABLED:
                // Enable player and perform initial animations
                if (this._isRunning) {
                    this.enable();
                    this._update();
                    this._animate();
                } else {
                    // If _update callback is firing but _isRunning is false then DBus connection is in a partial state (VLC)
                    // Try reconnecting but ask the function to not call update so we don't get stuck in a recursive loop
                    this.connect(false);
                }
                break;
        }
    }


    // Animates MPRIS player changing, uses BehaviourScale to drive animation
    _animateBscale() {
        //Remove any previous animation connections
        super.remove('animation');
        // Store current state to restore later and switch to ANIMATING
        let tempState = this.state;
        this.state = widgetState.ANIMATING;
        // Hide all buttons, animate label into view
        for(let b in this.buttons) {this.buttons[b].hide();}
        this.label.show();
        let labelInAnim = this._behaviourScale(this.label, this.startTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1);
        labelInAnim.start(); 

        // Wait for label to finish animating
        this._storeConnection('animation', labelInAnim, 'completed', this._bind(t => {
            // Hold position for this.waitTime ms
            GLib.timeout_add(0, this.waitTime, this._bind(() => {
                // Animate label out of view
                let labelOutAnim = this._behaviourScale(this.label, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0);
                labelOutAnim.start();
                this._storeConnection('animation', labelOutAnim, 'completed', this._bind(t => {
                    // Once label is out of view, hide label and hold position
                    this.label.hide();
                    GLib.timeout_add(0, this.waitTime, this._bind(() => {
                        // Ensure buttons are in correct state before displaying
                        this._updateButtonsState();
                        // Animate all buttons into view (hidden buttons wont show)
                        let endAnims = [];
                        for(let b in this.buttons) {
                            endAnims.push(this._behaviourScale(this.buttons[b], this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1));
                            endAnims[endAnims.length - 1].start();
                        }
                        // Once button animations are through, unlock widget by setting state to previous value
                        this._storeConnection('animation', endAnims[0], 'completed', this._bind(t => {
                            this.state = tempState; 
                            for(let b in this.buttons) {this.buttons[b].set_scale(1, 1);} 
                            this._update();
                        }));
                    }));
                }));
            }));
        }));
    }

    // Animates MPRIS player changing, uses Obj.ease to drive animation
    _animateEase() {
        // Store current state to restore later and switch to ANIMATING
        let tempState = this.state;
        this.state = widgetState.ANIMATING;
        // Hide all buttons, animate label into view
        for(let b in this.buttons) {this.buttons[b].hide();}
        this.label.show();
        this.label.set_scale(1, 0);
        this.label.ease({scale_y: 1, duration: this.startTime, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC,
            onComplete: this._bind(() => {
                GLib.timeout_add(0, this.waitTime, this._bind(() => {
                    this.label.set_scale(1, 1);
                    this.label.ease({scale_y: 0, duration: this.animTime, mode: Clutter.AnimationMode.EASE_IN_ELASTIC,
                        onComplete: this._bind(() => {
                            this.label.hide();
                            GLib.timeout_add(0, this.waitTime, this._bind(() => {
                                // Ensure buttons are in correct state before displaying
                                this._updateButtonsState();
                                let buttons = Object.values(this.buttons);
                                for (let i = buttons.length - 1; i >= 0; i--) {
                                    buttons[i].set_scale(1, 0);
                                    buttons[i].ease({scale_y: 1, duration: this.animTime, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC,
                                        onComplete: this._bind(() => {
                                            buttons[i].set_scale(1,1);
                                            if (i == 0) {
                                                this.state = tempState;
                                                this._update();
                                            }
                                        })
                                    });
                                }
                            }));
                        })
                    });
                }));
            })
        });
    }



    // Returns a button object, which has been childed under container
    _createContainerButton(iconName, container) {
        let button = new St.Bin({ style_class: 'panel-button', reactive: true, can_focus: true, track_hover: true});
        button.set_child(new St.Icon({icon_name: iconName, style_class: 'system-status-icon'}));
        container.insert_child_at_index(button, 0);
        return button;
    }

    // Builds a BehaviourScale animation object, returns timeline so that animation can be triggered
    _behaviourScale(object, duration, animationMode, xStart, xEnd, yStart, yEnd) {
        if (object === undefined || this.state != widgetState.ANIMATING) {
           logError("_behaviourScale likely called whilst removal in progress");
            return false;
        }
        let timeline = new Clutter.Timeline({'duration': duration});
        let alpha = new Clutter.Alpha({'timeline' : timeline, 'mode': animationMode});
        let behaviourScale = new Clutter.BehaviourScale({'alpha' : alpha, 'x_scale_start': xStart, 'x_scale_end': xEnd,
                                           'y_scale_start': yStart, 'y_scale_end' : yEnd});
        behaviourScale.apply(object);
        return timeline;
    }

    // If canPlay is true it means that DBus is working and the MPRIS player is active
    get _isRunning() {
        return this.proxy.CanPlay;
    }
    
}
