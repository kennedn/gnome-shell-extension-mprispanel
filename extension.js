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

const widgetState = Object.freeze({
    ENABLED: 1,
    DISABLED: 2,
    REMOVED: 3,
});
class MPRISWidget {

    constructor(busName, introspect) {
        this.busName = busName;
        this.introspect = introspect;
        this.proxy = null;
        this.playbackStatus = null;
        this.state = widgetState.ENABLED;
        this.connections = [];

        this.buttonContainer = new St.BoxLayout({ style_class: 'panel-status-menu-box', reactive: true,
                                                  can_focus: true, track_hover: true, vertical: false });
        this.buttons = {};
        this.buttons.forward = this._createButton('media-skip-forward-symbolic', this.buttonContainer);
        this.buttons.start = this._createButton('media-playback-start-symbolic', this.buttonContainer);
        this.buttons.pause = this._createButton('media-playback-pause-symbolic', this.buttonContainer);
        this.buttons.backward = this._createButton('media-skip-backward-symbolic', this.buttonContainer);

        this.buttons.pause.hide();

        this._dbusProxyConnect();
    }
    _createButton(iconName, container) {
        let icon = new St.Icon({icon_name: iconName, style_class: 'system-status-icon'});
        let button = new St.Bin({ style_class: 'panel-button', reactive: true, can_focus: true, 
                                  track_hover: true, x_fill: true, y_fill: false });
        button.set_child(icon);

        container.insert_child_at_index(button, 0);
        
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
            this._connect(this.buttons.start, 'button-press-event', this._bind(() => this.proxy.PlayRemote()));
            this._connect(this.buttons.pause, 'button-press-event', this._bind(() => this.proxy.PauseRemote()));
            this._connect(this.buttons.forward, 'button-press-event', this._bind(() => this.proxy.NextRemote()));
            this._connect(this.buttons.backward, 'button-press-event', this._bind(() => this.proxy.PreviousRemote()));
            this._connect(this.proxy, 'g-properties-changed', this._bind(this._onPropertyChange));
            // Call on_prop_change once so player is in correct starting state
            this._onPropertyChange();
        } catch (e) {
            logError(e);
        }
    }

    _connect(object, property, callback) {
        let handler = object.connect(property, callback);
        this.connections.push({"object": object, "handler": handler});
    }

    // Both Dbus & the MPRIS interface are active if CanPlay returns true
    get _isRunning() {
        let canPlay = this.proxy.CanPlay;
        return ( typeof canPlay === "boolean" && canPlay === true );
    }

    // Callback when properties change on the MPRIS interface
    _onPropertyChange(proxy, changedProperties, invalidatedProperties) {
        switch(this.state) {
            case widgetState.ENABLED:
                // Restore to left most index in rightBox if container has been moved
                if (Main.panel._rightBox.get_children()[0] != this.buttonContainer) {this.disable(); this.enable();}
                // Compare proxies PlaybackStatus to our last recorded value, process button shift if theres a mismatch
                if (this._isRunning) {
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
                } else {this.disable();}
                break;
            case widgetState.DISABLED:
                if (this._isRunning) {this.enable();}
                break;

        }
    }

    // Insert container onto panel
    enable() {
        switch (this.state) {
            case widgetState.DISABLED:
                Main.panel._rightBox.insert_child_at_index(this.buttonContainer, 0);
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

    // Run disable and additionally destroy the container and disconnect the on_props_changed event
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
}
