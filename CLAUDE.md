Repo with automations/scripts from smart home on Home Assistant.

- Use `Home Assistant` or HTTP API `https://domovoy.local` (with custom CA installed in the system) and use `HOMEASSISTANT_TOKEN` from `.env`.
- Before writing automations, consult `home/entities.yaml` for the list of home entities.
- Create automations/scripts on the server and copy them back by calling `./download-ha.ts`.
- Push automation edits to the server without asking.
- Ask user before creating any new entities.
- Set room for automation if it is related. See examples in `./automations/*.yaml`.
- After creating update automation `entityId` to use only English words.
- Try to avoid obvious comments.
- To all automations add condition that `input_boolean.stop` is `off`.
- Use the latest Node.js 26 API.
