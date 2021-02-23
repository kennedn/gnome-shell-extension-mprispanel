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
let widgetController;


function init() {}

function enable() {
    // Create a new MPRISWidget instance, object will enable itself when MPRIS player is running
    //widget = new MPRISWidget("org.mpris.MediaPlayer2.spotify", introspection.MPRIS);
    widgetController = new MPRISController(introspection.DBus, "org.freedesktop.DBus", 
                                           "/org/freedesktop/DBus", "org.mpris.MediaPlayer2");
    widgetController.connect();
    widgetController.startMonitor();
    // Connect buttons up to the MPRIS interface
    //widget.connect();

}

function disable() {
    // Call widget destructor function and null to remove instance reference
    // widget.remove();
    // widget = null;
}




class MPRISController {
    constructor(introspect, busInterface, busPath, filter) {
        this.introspect = introspect;
        this.proxy = null;
        this.busInterface = busInterface;
        this.busPath = busPath;
        this.filter = filter;
        this.widget = null;
        this.widgetBusInterface = null;
        this.state = widgetState.DISABLED;
    }

    connect() {
        let dbusWrapper = Gio.DBusProxy.makeProxyWrapper(this.introspect);
        try {this.proxy = new dbusWrapper(Gio.DBus.session, this.busInterface, this.busPath);} 
        catch (e) {logError(e);}
    }

    startMonitor() {
        if (this._isRunning) {
            let nextBusInterface = this._filterNames()[0];
            if (nextBusInterface !== this.widgetBusInterface) {
                this.widgetBusInterface = nextBusInterface;
                log("Would have changed to " + this.widgetBusInterface);
                // this.widget.remove();
                // this.widget = new MPRISWidget(introspection.MPRIS, "org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2");
            }
        }
        GLib.timeout_add(0, 100, this._bind(this.startMonitor));
    }
    get _isRunning() {
        let filteredNames = this._filterNames();
        return (filteredNames.length > 0);
    }

    _filterNames() {
        let filteredNames = this.proxy.ListNamesSync()[0].filter(v => v.includes(this.filter));
        return filteredNames;
    }

    // Convenience function to shorten binds
    _bind(func) {
        return Lang.bind(this, func);
    }

}

// get _mprisObjects() {
//  let dbusWrapper = Gio.DBusProxy.makeProxyWrapper(this.dbusIntrospect);
//  let dbus_proxy;
//  // If creating a proxy synchronously, you catch errors normally
//  try {
//      dbus_proxy = new dbusWrapper(
//          Gio.DBus.session,
//          'org.freedesktop.DBus',
//          '/org/freedesktop/DBus'
//      );
//  } catch (e) {
//      logError(e);
//  }
//  return dbus_proxy.ListNamesSync()[0].filter(v => v.includes("org.mpris.MediaPlayer2"));
// }


// Possible widget states
const widgetState = Object.freeze({
    ENABLED: 1,
    DISABLED: 2,
    REMOVED: 3,
});
class MPRISWidget extends MPRISController{

    constructor(introspect, busPath, busInterface) {
        super(introspect, busPath, busInterface);
        this.playbackStatus = null;
        this.state = widgetState.DISABLED;
        this.connections = [];

        // Collection of buttons that will be inserted and removed from the panel
        this.buttonContainer = new St.BoxLayout({ style_class: 'panel-status-menu-box', reactive: true,
                                                  can_focus: true, track_hover: true, vertical: false });
        
        // Create all required buttons, in the reverse order that they will appear in the panel
        this.buttons = {};
        this.buttons.forward = this._createContainerButton('media-skip-forward-symbolic', this.buttonContainer);
        this.buttons.start = this._createContainerButton('media-playback-start-symbolic', this.buttonContainer);
        this.buttons.pause = this._createContainerButton('media-playback-pause-symbolic', this.buttonContainer);
        this.buttons.backward = this._createContainerButton('media-skip-backward-symbolic', this.buttonContainer);

        // Hide pause so that we start with the play icon in center
        this.buttons.pause.hide();
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
    _onPropertyChange(proxy, changedProperties, invalidatedProperties) {
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
                if (this._isRunning) {this.enable();} // The MPRIS player is now active
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
