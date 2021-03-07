'use strict';

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


function init() {}

function buildPrefsWidget() {

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

    // Create parent widget
    let prefsWidget = new Gtk.Grid({
        margin: 18,
        column_spacing: 18,
        row_spacing: 18,
        visible: true,
    });

    // enabled-interfaces label
    let detectedLabel = new Gtk.Label({
        label: 'Detected players:',
        halign: Gtk.Align.START,
        visible: true
    });
    prefsWidget.attach(detectedLabel, 0, 0, 1, 1);

    // enabled-interfaces label
    let detected = new Gtk.Entry({
        text: this.settings.get_string('detected-interfaces'),
        halign: Gtk.Align.FILL,
        hexpand: true,
        visible: true,
        editable: false,
        can_focus: false
    });
    prefsWidget.attach(detected, 1, 0, 1, 1);

    // Bind the detected label to gsettings key
    this.settings.bind(
        'detected-interfaces',
        detected,
        'text',
        Gio.SettingsBindFlags.DEFAULT
    );

    // enabled-interfaces label
    let interfaceLabel = new Gtk.Label({
        label: 'Preferred players:',
        halign: Gtk.Align.START,
        visible: true,
        tooltip_text: "A comma seperated list of media players, first available player will be selected from left to right"
    });

    prefsWidget.attach(interfaceLabel, 0, 1, 1, 1);

    // enabled-interfaces, populate with text from gsettings
    let entry = new Gtk.Entry({
        text: this.settings.get_string('enabled-interfaces'),
        halign: Gtk.Align.FILL,
        hexpand: true,
        visible: true
    });
    prefsWidget.attach(entry, 1, 1, 1, 1);
    
    // Create a 'set' button for text input
    let button = new Gtk.Button({
        label: 'Set',
        visible: true
    });
    prefsWidget.attach(button, 2, 1, 1, 1);

    // Copy entry.text to gsettings when set button is clicked
    button.connect('clicked', (b) => {
        this.settings.set_string('enabled-interfaces', entry.text);
    }); 

    // Create a label & switch for `show-indicator`
    let toggleLabel = new Gtk.Label({
        label: 'Whitelist:',
        halign: Gtk.Align.START,
        visible: true,
        tooltip_text: "Make 'Preferred players' act like a whitelist, ignoring any remaining players"
    });
    prefsWidget.attach(toggleLabel, 0, 2, 1, 1);

    let toggle = new Gtk.Switch({
        active: this.settings.get_boolean('whitelist'),
        halign: Gtk.Align.START,
        visible: true
    });
    prefsWidget.attach(toggle, 1, 2, 1, 1);

    // Bind the switch to the `show-indicator` key
    this.settings.bind(
        'whitelist',
        toggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Resize the window to minimum width on creation
    prefsWidget.connect('realize', () => prefsWidget.get_toplevel().resize(1, 1));

    // Return our widget which will be added to the window
    return prefsWidget;
}