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
        margin_start: 18,
        margin_end: 18,
        margin_top: 18,
        margin_bottom: 18,
        column_spacing: 18,
        row_spacing: 18,
        visible: true,
    });

    // enabled-interfaces label
    let detectedLabel = new Gtk.Label({
        label: 'Detected players',
        halign: Gtk.Align.START,
        tooltip_text: "A list of all currently running MPRIS players, entries listed here can be used in 'Preferred players'",
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
        label: 'Preferred players',
        halign: Gtk.Align.START,
        visible: true,
        tooltip_text: "For when more than one player is running.\nA comma seperated list of MPRIS players, the first MPRIS player will be selected from left to right"
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
        // Filter input down to a comma seperated list of values
        entry.set_text(entry.text.replace(/\s/g, '').toLowerCase().split(",").filter(n => n).join(","));
        this.settings.set_string('enabled-interfaces', entry.text);
    }); 

    // Create a label & switch for `whitelist`
    let whitelistLabel = new Gtk.Label({
        label: 'Ignore remainder',
        halign: Gtk.Align.START,
        visible: true,
        tooltip_text: "Ignore MPRIS players not explicitly specified in 'Preferred players'"
    });
    prefsWidget.attach(whitelistLabel, 0, 2, 1, 1);

    let whitelistToggle = new Gtk.Switch({
        active: this.settings.get_boolean('whitelist'),
        halign: Gtk.Align.START,
        visible: true
    });
    prefsWidget.attach(whitelistToggle, 1, 2, 1, 1);

    // Bind the switch to the `whitelist` key
    this.settings.bind(
        'whitelist',
        whitelistToggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );


    // Create a label & switch for `whitelist`
    let hoverLabel = new Gtk.Label({
        label: 'Tooltip',
        halign: Gtk.Align.START,
        visible: true,
        tooltip_text: "Display current MPRIS player on widget hover"
    });
    prefsWidget.attach(hoverLabel, 0, 3, 1, 1);

    let hoverToggle = new Gtk.Switch({
        active: this.settings.get_boolean('mouse-hover'),
        halign: Gtk.Align.START,
        visible: true
    });
    prefsWidget.attach(hoverToggle, 1, 3, 1, 1);

    // Bind the switch to the `hover` key
    this.settings.bind(
        'mouse-hover',
        hoverToggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    

    // Resize the window to minimum dimensions on creation
    prefsWidget.connect('realize', () => {
        if (typeof prefsWidget.get_root === 'function') {
            let window = prefsWidget.get_root();
            window.default_width = 1;
            window.default_height = 1;
        } else {
            prefsWidget.get_toplevel().resize(1, 1);
        }
    });

    // Return our widget which will be added to the window
    return prefsWidget;
}