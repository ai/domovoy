# Wall Switch

## How it works

The Shelly uses Wi-Fi for Home Assistant and its own Zigbee radio as a backup. The button is in detached mode: pressing it sends an event instead of cutting power to the smart bulbs, so they stay available for automations.

- **Single press:** toggles the lights. With HA, turning them on sets full brightness and optionally the configured color temperature.
- **Hold:** switches between warm, dim night mode and full brightness. This needs HA, as do extra actions and the optional flag that prevents motion automations from turning the lights off.
- **Works during outages:** basic single-press control still works without HA, Zigbee2MQTT, Wi-Fi, or the MQTT broker, provided the Shelly and bulbs have power and can communicate over Zigbee. No internet or cloud service is needed.
- **Low latency:** normal presses go straight through HA → Z2M → bulbs, without waiting for the backup timer or requesting a brightness transition. If MQTT is disconnected, the backup acts as soon as the Shelly recognizes a single press. If MQTT is connected but Z2M stays silent, fallback takes about one second. Backup commands go to each bulb 120 ms apart.

The “magic” is a small script listening to the Z2M group's MQTT state topic. After a single press, it gives HA one second to handle it. Any message on that topic cancels the backup. If nothing arrives, the Shelly sends a Zigbee toggle directly to each configured bulb. If MQTT is already disconnected, it skips the wait entirely. This fallback only toggles the bulbs, keeping their remembered brightness and color.

## Setup

1. In Zigbee2MQTT create a group for all selected lights in the room. Add them to this group.
2. In Zigbee2MQTT prepare list of light IDs in `Devices` -> bulb -> `Network address` (something like `0x1A2B`). Change letters to lower case.
3. Install `Shelly 1PM Mini` or `Shelly 2PM` in wall switch and replace normal wall switch 2 stages button to push-button(s). On `Shelly 2PM` only one button controls the light; the second one drives a fan on its own relay and stays outside the system.
4. Connect to Shelly AP WiFi with name like `Shelly…`. On Android click `Use this network` in popup. Open `http://192.168.33.1` and put your home WiFi credentials.
5. Open you WiFi router UI and find the IP address on new switch in your network. Open this IP address in the browser.
6. Go `Settings → Firmware` and install `2.0.0-…` alternative firmware with Zigbee. Wait the end of flashing new firmware.
7. Enable `Enable update to stable version`.
8. In `Settings` set name to something like `Wall Switch / ROOM`.
9. Go to `Home` → `Output` → `Input/Output settings` and set the light channel Input Mode to `Button` and Output Type to `Detached`.

10. Generate a password for the switches:

    ```sh
    node -p "crypto.randomUUID()"
    ```

11. Create the broker credentials in Home Assistant: `Settings` → `Add-ons` → `Mosquitto broker` → `Configuration`, switch to text editor and add a login:

    ```yaml
    logins:
      - username: wall-switch
        password: GENERATED_PASSWORD
    ```

    Restart the add-on.

12. Go to `Settings` → `Connectivity` → `MQTT`, enable it and set the broker with credentials. The script listens there to see whether Zigbee2MQTT is still executing commands. The same over RPC, reboot is needed as well:

    ```sh
    curl -X POST http://SWITCH_IP/rpc/MQTT.SetConfig -d '{
      "config": {
        "enable": true,
        "server": "MQTT_IP:1883",
        "user": "wall-switch",
        "pass": "GENERATED_PASSWORD",
        "enable_rpc": false,
        "enable_control": false
      }
    }'
    curl http://SWITCH_IP/rpc/Shelly.Reboot
    ```

13. In `Scripts` create new script with [`wall-switch.js`](../shelly/wall-switch.js). Replace `LIGHTS` with light IDs from step 2 and set `GROUP_TOPIC` to `zigbee2mqtt/` plus the group name from step 1. Save and Run it. Return back to `Scripts` and enable `Run on startup`.
14. In `Zigbee` click `Start pairing`.
15. Open Zigbee2MQTT and press `Permit join`.
16. Wait until you will see new wall switch. Set the same `Wall Switch / ROOM` name.
17. In Home Assistant add your device again via `Shelly` (WiFi) integration.
18. Go to `Settings` → `Automations` → `Blueprints` and import [`wall-switch`](../blueprints/automation/domovoy/wall-switch.yaml) blueprint via `https://raw.githubusercontent.com/ai/domovoy/refs/heads/main/blueprints/automation/domovoy/wall-switch.yaml` URL.
19. For every room create an automation using this blueprint. On `Shelly 2PM` set `Button` to the button that controls the light (`button1` or `button2`).
