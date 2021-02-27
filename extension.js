"use strict";

const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
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
    widgetController.disable();
    widgetController = null;
}

String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

// Base class defines a connection to a DBus interface via proxy
class DBusProxy {
    constructor(introspect, busInterface, busPath) {
        this.introspect = introspect;
        this.proxy = null;
        this.busInterface = busInterface;
        this.busPath = busPath;
    }

    connect() {
        let dbusWrapper = Gio.DBusProxy.makeProxyWrapper(this.introspect);
        try {this.proxy = new dbusWrapper(Gio.DBus.session, this.busInterface, this.busPath);} 
        catch (e) {logError(e);}
    }

    // Convenience function to shorten binds
    _bind(func) {
        return Lang.bind(this, func);
    }
}


// Possible widget states
const widgetState = Object.freeze({
    ENABLED: 1,
    DISABLED: 2,
    REMOVED: 3,
});

// Defines a controller class that manages a child widget based on MPRIS interfaces availabe on DBus
class MPRISController extends DBusProxy {
    constructor(dbusIntrospect, mprisIntrospect, busInterface, busPath, filter) {
        super(dbusIntrospect, busInterface, busPath);
        this.filter = filter;
        this.widget = null;
        this.mprisIntrospect = mprisIntrospect;
        this.widgetBusInterface = null;
        this.state = widgetState.DISABLED;
    }

    // Monitor periodically for changes to DBus interfaces and recreate the widget with new interface if required
    _startMonitor() {
        switch (this.state) {
            case widgetState.ENABLED:
                // Get the top MPRIS interface from array of possible interfaces
                let nextInterface = this._mprisInterfaces[0];
                // Check for valid interface, must differ from current interface
                if (nextInterface !== undefined && nextInterface !== this.widgetBusInterface) {
                    this.widgetBusInterface = nextInterface;
                    // Only bother to remove if the object exists
                    if (this.widget !== null) {this.widget.remove();}
                    // Create a new widget with nextInterface and connect its signals up
                    this.widget = new MPRISWidget(this.mprisIntrospect, this.widgetBusInterface, "/org/mpris/MediaPlayer2");
                    this.widget.connect();
                }
                // Run monitor again in 250ms
                GLib.timeout_add(0, 100, this._bind(this._startMonitor));
                break;
        }
    }

    // Connect DBus proxy and start monitoring for MPRIS changes
    enable() {
        switch (this.state) {
            case widgetState.DISABLED:
                this.state = widgetState.ENABLED;
                this.connect();
                this._startMonitor();
                break;
        }
    }

    // Cleanly remove active widget and change state to REMOVED to break _startMonitor() loop;
    disable() {
        switch (this.state) {
            case widgetState.ENABLED:
                this.widget.remove();
                this.widget = null;
                this.state = widgetState.REMOVED;
                break;
        }
    }

    // Get a list of available DBus interfaces and filter down to MPRIS items
    get _mprisInterfaces() {
        return this.proxy.ListNamesSync()[0].filter(v => v.includes("org.mpris.MediaPlayer2"));
    }

}

// Defines a widget that exposes MPRIS controls as buttons on the gnome panel
class MPRISWidget extends DBusProxy{
    constructor(introspect, busInterface, busPath) {
        super(introspect, busInterface, busPath);
        this.playbackStatus = null;
        this.state = widgetState.DISABLED;
        this.connections = [];

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

        this.label = new St.Label({text: this.busInterface.split(".")[3].capitalize(),
                                   x_expand: true, x_align: Clutter.ActorAlign.CENTER,
                                   y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.buttonContainer.insert_child_at_index(this.label, 0);
        this.label.hide();

        this.animTime = 250;
        this.waitTime = 90;
    }

    behaviourScale(object, duration, animationMode, xStart, xEnd, yStart, yEnd) {
        let timeline = new Clutter.Timeline({'duration': duration});
        let alpha = new Clutter.Alpha({'timeline' : timeline, 'mode': animationMode});
        let behaviourScale = new Clutter.BehaviourScale({'alpha' : alpha, 'x_scale_start': xStart, 'x_scale_end': xEnd,
                                           'y_scale_start': yStart, 'y_scale_end' : yEnd});
        behaviourScale.apply(object);
        return timeline;
    }
    startAnimation() {

        let startAnim = this._bind(() => {
            this.behaviourScale(this.buttons.forward, this.waitTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 0, 1).start();
            this.behaviourScale(this.buttons.start, this.waitTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 0, 1).start();
            this.behaviourScale(this.buttons.pause, this.waitTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 0, 1).start();
            this.behaviourScale(this.buttons.backward, this.waitTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 0, 1).start();
        });
        let midAnim = this._bind(() => {
            let forwardAnim = this.behaviourScale(this.buttons.forward, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0);
            forwardAnim.start();
            this.behaviourScale(this.buttons.start, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0).start();
            this.behaviourScale(this.buttons.pause, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0).start();
            this.behaviourScale(this.buttons.backward, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0).start();

            this._storeConnection(forwardAnim, 'completed', this._bind((t) => {
                //Object.entries(this.buttons).forEach(([k, v]) => v.hide());
                this.buttons.forward.hide();
                this.buttons.backward.hide();
                this.buttons.pause.hide();
                this.buttons.start.hide();
                GLib.timeout_add(0, this.waitTime, this._bind(() => {
                    this.label.show();
                    this.behaviourScale(this.label, this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1).start();
                }));
            }));
        });
        let endAnim = this._bind(() => {
            let labelAnim = this.behaviourScale(this.label, this.animTime, Clutter.AnimationMode.EASE_IN_ELASTIC, 1, 1, 1, 0);
            labelAnim.start();
            this._storeConnection(labelAnim, 'completed', this._bind((t) => {
                this.label.hide();
                GLib.timeout_add(0, this.waitTime, this._bind(() => {
                    this.buttons.forward.show();
                    this.buttons.backward.show();
                    switch(this.playbackStatus) {
                        case "Paused":
                            this.buttons.pause.hide();
                            this.buttons.start.show();
                            this.behaviourScale(this.buttons.start, this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1).start();
                            this.buttons.pause.set_scale(1, 1);
                            break;
                        case "Playing":
                            this.buttons.start.hide();  
                            this.buttons.pause.show();
                            this.behaviourScale(this.buttons.pause, this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1).start();
                            this.buttons.start.set_scale(1, 1);
                            break;
                    }
                    this.behaviourScale(this.buttons.forward, this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1).start();
                    this.behaviourScale(this.buttons.backward, this.animTime, Clutter.AnimationMode.EASE_OUT_ELASTIC, 1, 1, 0, 1).start();
                }));
            }));
        });

        startAnim();
        GLib.timeout_add(0, this.waitTime * 2,  midAnim);
        GLib.timeout_add(0, this.animTime * 2 + this.waitTime * 4, endAnim);
    }

    // Attempts to establish a connection to MPRIS interface and connect buttons and callbacks up
    connect() {
        super.connect();
        // Attach callbacks for each button and to watch for property changes on the mpris interface
        this._storeConnection(this.buttons.start, 'button-press-event', this._bind(() => this.proxy.PlayRemote()));
        this._storeConnection(this.buttons.pause, 'button-press-event', this._bind(() => this.proxy.PauseRemote()));
        this._storeConnection(this.buttons.forward, 'button-press-event', this._bind(() => this.proxy.NextRemote()));
        this._storeConnection(this.buttons.backward, 'button-press-event', this._bind(() => this.proxy.PreviousRemote()));
        this._storeConnection(this.proxy, 'g-properties-changed', this._bind(this._onPropertyChange));
        // Call onPropertyChange once in case MPRIS player is already open.
        this._onPropertyChange();
        this.startAnimation();
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
        switch (this.state) {
            case widgetState.ENABLED:
                this.disable();
            case widgetState.DISABLED:
                // Disconnect all signals
                this.connections.forEach((c) => c.object.disconnect(c.handler));
                // Destroy children and container
                this.buttonContainer.destroy();
                // Mark class instance as removed
                this.state = widgetState.REMOVED;
                break;
        }
    }

    // Create a button object with a passed icon and child it to a parent container
    _createContainerButton(iconName, container) {
        let button = new St.Bin({ style_class: 'panel-button', reactive: true, can_focus: true, 
                                  track_hover: true, x_fill: true, y_fill: false });

        button.set_child(new St.Icon({icon_name: iconName, style_class: 'system-status-icon'}));
        container.insert_child_at_index(button, 0);
        return button;
    }

    // Modifies widget behavior based on MPRIS player's state
    _onPropertyChange() {
        log("State: " + this.state + ", Running: " + this._isRunning + " PlaybackStatus: " + this.proxy.PlaybackStatus);
        switch(this.state) {
            case widgetState.ENABLED:
                // Restore widget to left most index in rightBox if container has moved
                if (Main.panel._rightBox.get_children()[0] != this.buttonContainer) {this.disable(); this.enable();}
                if (this._isRunning) {
                    // Callback fires multiple times so check if PlaybackStatus is different from last time we fired.
                    let playbackStatus = this.proxy.PlaybackStatus;
                    if(this.playbackStatus != playbackStatus) {
                        this.playbackStatus = playbackStatus;
                        // Swap Pause and Play buttons out from hiding based on playbackState
                        switch(playbackStatus) {
                            case "Paused":
                                this.buttons.pause.hide();
                                this.buttons.start.show();
                                break;
                            case "Playing":
                                this.buttons.start.hide();  
                                this.buttons.pause.show();
                                break;
                        }
                    }
                } else {this.disable();} // The MPRIS player is no longer active
                break;
            case widgetState.DISABLED:
                if (this._isRunning) {this.enable(); this._onPropertyChange();} // The MPRIS player is now active
                break;

        }
    }

    // If canPlay is true it means that DBus is working and the MPRIS player is active
    get _isRunning() {
        return this.proxy.CanPlay;
    }
    
    // Connects a callback up to an objects property, storing handler and object for later disconnect
    _storeConnection(object, property, callback) {
        this.connections.push({"object": object, "handler": object.connect(property, callback)});
    }
}
