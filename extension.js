"use strict";

const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
let introspection = {};
introspection.DBus = Me.imports.dbus.DBus.Introspection;
introspection.MPRIS = Me.imports.dbus.MPRIS.Introspection;
let widget;


function init() {}
function enable() {
    widget = new MPRISWidget("org.mpris.MediaPlayer2.spotify", introspection.MPRIS);
    widget.enable();
}

function disable() {
    widget.remove();
    widget = null;
}

class MPRISWidget {
    constructor(busName, introspect) {
        this.busName = busName;
        this.introspect = introspect;
        this.proxy = null;
        this.disabled = true;
        this.removed = false;
        this.playbackStatus = false;
        this.propsHandle = null;
        this.buttons = {};
        this.buttons.start = this._createButton(new St.Icon({icon_name: 'media-playback-start-symbolic', style_class: 'system-status-icon' }));
        this.buttons.pause = this._createButton(new St.Icon({icon_name: 'media-playback-pause-symbolic', style_class: 'system-status-icon' }));
        this.buttons.forward = this._createButton(new St.Icon({icon_name: 'media-skip-forward-symbolic', style_class: 'system-status-icon' }));
        this.buttons.backward = this._createButton(new St.Icon({icon_name: 'media-skip-backward-symbolic', style_class: 'system-status-icon' }));

        this.buttonContainer = new St.BoxLayout({ style_class: 'panel-status-menu-box',
                                                  reactive: true,
                                                  can_focus: true,
                                                  track_hover: true,
                                                  vertical: false });

        this.buttonContainer.insert_child_at_index(this.buttons.forward, 0);
        this.buttonContainer.insert_child_at_index(this.buttons.start, 0);
        this.buttonContainer.insert_child_at_index(this.buttons.pause, 0);
        this.buttonContainer.insert_child_at_index(this.buttons.backward, 0);
        this.buttons.pause.hide();

        this._dbusProxyConnect();

    }
    _createButton(icon) {
        let button = new St.Bin({ style_class: 'panel-button',
                          reactive: true,
                          can_focus: true,
                          track_hover: true,
                          x_fill: true,
                          y_fill: false });
        
        button.set_child(icon);
        
        return button;
    }

    _bind(func) {
        return Lang.bind(this, func);
    }

    _dbusProxyConnect() {
        let dbusWrapper = Gio.DBusProxy.makeProxyWrapper(this.introspect);
        // Try and create a dbus proxy object then create callback connections for the buttons
        try {
            this.proxy = new dbusWrapper(
                Gio.DBus.session,
                this.busName,
                '/org/mpris/MediaPlayer2'
            );
            // Attach callbacks for each button and to watch for property changes on the mpris interface
            this.buttons.start.connect('button-press-event', this._bind(() => {this.proxy.PlayRemote();}));
            this.buttons.pause.connect('button-press-event', this._bind(() => {this.proxy.PauseSync();}));
            this.buttons.forward.connect('button-press-event', this._bind(() => {this.proxy.NextSync();}));
            this.buttons.backward.connect('button-press-event', this._bind(() => {this.proxy.PreviousSync();}));
            // Capture connection handle for later disconnection if we disable extension in tweaks
            this.propsHandle = this.proxy.connect("g-properties-changed", this._bind(this.on_prop_change));
            // Run callback once to update buttons to their correct initial state
            GLib.timeout_add(0, 300, this._bind(this.on_prop_change));
        } catch (e) {
            logError(e);
        }
    }

    // Both Dbus & the MPRIS interface are active if CanPlay returns true
    get is_running() {
        if (this.proxy !== null) {
            let canPlay = this.proxy.CanPlay;
            return ( typeof canPlay === "boolean" && canPlay === true );
        }
        return false;
    }

    // Callback when properties change on the MPRIS interface
    on_prop_change(proxy, changed_properties, invalidated_properties) {
        if (this.is_running && this.disabled) {
            this.enable();
        } 
        else if(!this.is_running) {
            this.disable();
        }

        // Compare proxies PlaybackStatus to our last recorded value, process button shift if theres a mismatch
        let playbackStatus = this.proxy.PlaybackStatus;
        if(this.playbackStatus != playbackStatus) {
            this.playbackStatus = playbackStatus;
            // Swap Pause and Play buttons out from hiding
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

        // Restore to left most index in rightBox if container has been moved
        if (!this.disabled && Main.panel._rightBox.get_children()[0] != this.buttonContainer) {
            this.disable();
            this.enable();
        }
    }

    // Insert container onto panel
    enable() {
        if (this.is_running && !this.removed) {
            Main.panel._rightBox.insert_child_at_index(this.buttonContainer, 0);
            this.disabled = false;
        }
    }

    // Remove container from panel
    disable() {
        Main.panel._rightBox.remove_child(this.buttonContainer);
        this.disabled = true;
    }

    // Run disable and additionally destroy the container and disconnect the on_props_changed event
    remove() {
        this.disable();
        this.buttonContainer.destroy();
        this.proxy.disconnect(this.propsHandle);
        this.removed = true;
    }
}
