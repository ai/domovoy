# Wall Switch

1. Install `Shelly 1PM Mini` in wall switch and replace normal wall switch 2 stages button to push-button.
2. Connect to Shelly AP WiFi with name like `Shelly…`. On Android click `Use this network` in popup. Open `http://192.168.33.1` and put your home WiFi credentials.
3. Open you WiFi router UI and find the IP address on new switch in your network. Open this IP address in the browser.
4. Go `Settings → Firmware` and install `2.0.0-…` alternative firmware with Zigbee. Wait the end of flashing new firmware.
5. Enable `Enable update to stable version`.
6. In `Settings` set name to something like `Wall Switch / ROOM`.
7. Go to `Home` → `Output` → `Input/Output settings` and set Input Mode to `Button` and Output Type to `Detached`.
8. TODO: Check light ID in Zigbee2MQTT.h in the Zigbee2MQTT. Set name to the same `Wall Switch / ROOM`.
9. In `Scripts` create new script with [`wall-switch.js`](../shelly/wall-switch.js). Save and Run it. Return back to `Scripts` and enable `Run on startup`. The script is only a fallback for the HA automation: on press it reads the on/off state of the first light in `LIGHTS`, waits 100 ms and reads it again — if the state did not change (HA is down), it sends explicit on/off to all lights itself. Put the closest/most reliable bulb first in `LIGHTS`.
10. In `Zigbee` click `Start pairing`.
11. Open Zigbee2MQTT and press `Permit join`.
12. Wait until you will see new wall switch. Set the same `Wall Switch / ROOM` name.
13. Create a Zigbee2MQTT group with the room lights if it does not exist yet and add the group entity to the Adaptive Lighting lights list.
14. Add automation from the [`wall-switch`](../blueprints/automation/domovoy/wall-switch.yaml) blueprint: pick the switch device and the light group. Press turns the group on (Adaptive Lighting fills in brightness/color via intercept) or off, hold enables the night mode; the Shelly script kicks in only when HA does not react. Check in the switch device page in HA that a short press arrives as the `input_1_single` action (the blueprint trigger expects this subtype).

TODO: in some cases strange bugs can be fixed by reconfigure. Check that you light have reporting.
