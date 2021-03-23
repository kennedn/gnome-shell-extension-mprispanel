# gnome-shell-extension-mprispanel

Adds controls to the gnome panel for MPRIS enabled media players

Uses DBus to interact with all available media players. A 'smart-switching' technique is leveraged to decide which player to control.

## Preferences

| Field              | Description                                           |
|--------------------|-------------------------------------------------------|
| Detected Players   | A list of active players detected by mpris panel      |
| Preferred Players  | A comma seperated list of media players, first available player will be selected from left to right|
| Whitelist          | Ignore players not specified in Preferred Players     |

## Example

Users can specify a list of preferred media players to control. **mprispanel** will select the first available player it can find, and if whitelist is set to false, will then pick from any remaining players.

For example, in the below settings we have enabled spotify as our primary player, with firefox as a close second. The player will always try to pick the most 'preferred' player to control:

<img src="images/gsettings.png" width="400"/>

<img src="images/mprispanel.gif" width="600"/>
