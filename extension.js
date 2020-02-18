const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// function fires everytime a property defined as part of our proxy changes
// the variables passed into this function aren't that useful
// proxy is just an instance of spotify_proxy
// changed_properties is a GLib.Variant packed json object with a list of changed properties (usually all of them)
// theres probably a better way of firing for a specific property that we care about
// but i couldn't figure it out or find any docs.
function on_prop_change(proxy, changed_properties, invalidated_properties) {
    // Check that we got a value for our dbus query (spotify is running), enable and disable the extension accordingly
    let temp_status = spotify_proxy.PlaybackStatus;
    if (typeof(temp_status) !== 'string') { 
      disable(); 
    } else if(!enabled) {
      enable();
    }
   
    // If we get bumped somewhere between other icons in the notification panel, get us added to the index again
    // E.g stay to the left in the panel. 
    if (Main.panel._rightBox.get_child_at_index(0) != container) { disable(); enable(); }


    // Change play button icon based on spotify player state
    if (local_status != temp_status) {
      if (temp_status == "Paused"){
        change_buttons_icon(1, 'media-playback-start-symbolic');
      }
      else {
        change_buttons_icon(1, 'media-playback-pause-symbolic');
      }
      local_status = temp_status;
    } 
}

// Check if we got a value back for a dbus query, if not it means spotify isn't running
function is_started() {
    let temp_status = spotify_proxy.PlaybackStatus;
    if (typeof(temp_status) !== 'string') { 
      return false;
    } else {
      return true;
    }
}

// Simple function to change a buttons icon    
function change_buttons_icon(button_index, change_icon_name) {
    buttons[button_index].set_child(new St.Icon({ icon_name: change_icon_name,
                               style_class: 'system-status-icon' }));
}
  
/*
This the a definition for a Dbus Proxy interface
From my understanding of it, it creates a minimalised mapping between items defined in the proxy xml and a larger bus (session bus in our case)
Benifits of this are you get by with actively monitoring a sliver of a bus rather than polling the entire larger bus for changes 

In this case we are creating a mapping for useful mpris methods/properties which are executed/maintained by the spotify client.

With these methods we can do some useful stuff, like know what state spotify is in, play, pause, next, previous, download cover art etc. 
*/
const spotify_dbus_xml = `<node>
<interface name="org.mpris.MediaPlayer2.Player"> 
    <method name="PlayPause"/> 
    <method name="Next"/> 
    <method name="Previous"/> 
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
</interface> 
</node>`;

// Create a proxy wrapper object based on our xml to allow us to initalise the proxy
const spotify_proxy_wrapper = Gio.DBusProxy.makeProxyWrapper(spotify_dbus_xml);

//Initialise the proxy using our wrapper, point it towards the MP2 interface which belongs to the spotify mpris object in the session bus
// Look at d-feet to get these args
// Any changes we now make locally to our proxy should be reflected in the session bus and vice versa
let spotify_proxy = spotify_proxy_wrapper(Gio.DBus.session,"org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2");

let local_status, enabled, container, buttons, icons, dbus_callbacks;

function init() {
    
    // gjs doesn't like declaring and initalising arrays in the same line, ¯\_(ツ)_/¯,  initalising our arrays for later  
    buttons=[];
    icons=[];
    dbus_callbacks=[];
     
    // Push Icons into our array, these need to be back to front because we are inserting into a container at index each time
    icons.push(new St.Icon({icon_name: 'media-skip-forward-symbolic',  style_class: 'system-status-icon' }));
    icons.push(new St.Icon({icon_name: 'media-skip-start-symbolic',    style_class: 'system-status-icon' }));
    icons.push(new St.Icon({icon_name: 'media-skip-backward-symbolic', style_class: 'system-status-icon' }));
  
    // Push our anon callback functions into array, Function name corresponds to the method name on the bus + Sync.
    // Back to front for the same reason as the icons
    dbus_callbacks.push(function() { spotify_proxy.NextSync(); }); 
    dbus_callbacks.push(function() { spotify_proxy.PlayPauseSync(); }); 
    dbus_callbacks.push(function() { spotify_proxy.PreviousSync(); }); 
  
    // A Container to place all of our nice buttons in
    container = new St.BoxLayout({ style_class: 'panel-status-menu-box',
                          reactive: true,
                          can_focus: true,
                          track_hover: true,
                          vertical: false });

    // For loop to cut down on repitition, achieved the following;
    // - Create our button object
    // - Append the Icon we created earlier as a child of the button
    // - Child each button to the container
    // - Connect our dbus callback functions up to each buttons press event
    for (i = 0; i < 3; i++) {
      buttons.push(new St.Bin({ style_class: 'panel-button',
                          reactive: true,
                          can_focus: true,
                          track_hover: true,
                          x_fill: true,
                          y_fill: false }));
      buttons[i].set_child(icons[i]);
      
      container.insert_child_at_index(buttons[i], 0);
      buttons[i].connect('button-press-event', dbus_callbacks[i]);
    }

    // Connect the g-properties-changed event to our callback
    // This fires everytime a property gets changed in our proxies scope (refer to xml). 
    spotify_proxy.connect("g-properties-changed", on_prop_change);

    // call on_prop_change callback once to get the correct button state
    // for the play/pause button.
    on_prop_change();
  
}

//Insert into panel notification area if spotify is running
function enable() {
 
    if (is_started()) {
      Main.panel._rightBox.insert_child_at_index(container, 0);
      enabled = true;
    }
}

//Remove from panel notification area
function disable() {
    Main.panel._rightBox.remove_child(container);
    enabled = false;
}
