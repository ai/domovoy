# Wall Switch

1. In Zigbee2MQTT create a group for all selected lights in the room. Add them to this group.
2. In Zigbee2MQTT prepare list of light IDs in `Devices` -> bulb -> `Network address` (something like `0x1A2B`). Change letters to lower case.
3. Install `Shelly 1PM Mini` or `Shelly 2PM` in wall switch and replace normal wall switch 2 stages button to push-button(s). On `Shelly 2PM` only one button controls the light; the second one drives a fan on its own relay and stays outside the system.
4. Connect to Shelly AP WiFi with name like `Shelly…`. On Android click `Use this network` in popup. Open `http://192.168.33.1` and put your home WiFi credentials.
5. Open you WiFi router UI and find the IP address on new switch in your network. Open this IP address in the browser.
6. Go `Settings → Firmware` and install `2.0.0-…` alternative firmware with Zigbee. Wait the end of flashing new firmware.
7. Enable `Enable update to stable version`.
8. In `Settings` set name to something like `Wall Switch / ROOM`.
9. Go to `Home` → `Output` → `Input/Output settings` and set the light channel Input Mode to `Button` and Output Type to `Detached`.
10. In `Scripts` create new script with [`wall-switch.js`](../shelly/wall-switch.js). Replace `LIGHTS` with light IDs from step 2. Save and Run it. Return back to `Scripts` and enable `Run on startup`.
11. In `Zigbee` click `Start pairing`.
12. Open Zigbee2MQTT and press `Permit join`.
13. Wait until you will see new wall switch. Set the same `Wall Switch / ROOM` name.
14. In Home Assistant add your device again via `Shelly` (WiFi) integration.
15. Go to `Settings` → `Automations` → `Blueprints` and import [`wall-switch`](../blueprints/automation/domovoy/wall-switch.yaml) blueprint via `https://raw.githubusercontent.com/ai/domovoy/refs/heads/main/blueprints/automation/domovoy/wall-switch.yaml` URL.
16. For every room create an automation using this blueprint. On `Shelly 2PM` set `Кнопка` to the button that controls the light (`button1` or `button2`).
