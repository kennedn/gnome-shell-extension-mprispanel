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
    widget.disable();
    widget = null;
}

class MPRISWidget {
    constructor(busName, introspect) {
        this.busName = busName;
        this.introspect = introspect;
        this.proxy = null;
        this.disabled = true;
        this.playbackStatus = false;
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
        // If creating a proxy synchronously, you catch errors normally
        try {
            this.proxy = new dbusWrapper(
                Gio.DBus.session,
                this.busName,
                '/org/mpris/MediaPlayer2'
            );
            this.buttons.start.connect('button-press-event', this._bind(() => {this.proxy.PlayRemote();}));
            this.buttons.pause.connect('button-press-event', this._bind(() => {this.proxy.PauseSync();}));
            this.buttons.forward.connect('button-press-event', this._bind(() => {this.proxy.NextSync();}));
            this.buttons.backward.connect('button-press-event', this._bind(() => {this.proxy.PreviousSync();}));
            this.proxy.connect("g-properties-changed", this._bind(this.on_prop_change));
            this.on_prop_change();
        } catch (e) {
            logError(e);
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
    get is_running() {
        let canPlay = this.proxy.CanPlay;
        return ( this.proxy !== null && typeof canPlay === "boolean" && canPlay === true );
    }

    on_prop_change(proxy, changed_properties, invalidated_properties) {
        if (this.is_running && this.disabled) {
            this.enable();
        } 
        else if(!this.is_running) {
            this.disable();
        }
        let playbackStatus = this.proxy.PlaybackStatus;
        if(this.playbackStatus != playbackStatus) {
            this.playbackStatus = playbackStatus;
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

    }

    enable() {
        if (this.is_running) {
            Main.panel._centerBox.insert_child_at_index(this.buttonContainer, 0);
            this.disabled = false;
        }
    }

    disable() {
        Main.panel._centerBox.remove_child(this.buttonContainer);
        this.disabled = true;
    }
}
