# Thermostat control through Home Assistant

`home_assistant_set_temperature` changes the target setpoint of one Home
Assistant climate entity using the `climate.set_temperature` service.

## Inputs and validation

- `entity_id` is required and must match `climate.[a-z0-9_]+`, for example
  `climate.hallway_hallway`.
- `temperature_fahrenheit` is required, must be a finite number, and must be
  between 40 and 95 °F inclusive.
- Home Assistant credentials are read only from server configuration. The tool
  does not accept a token or password.

The tool returns the validated entity and Fahrenheit setpoint after Home
Assistant accepts the service call. Home Assistant HTTP failures are returned
as tool errors and do not produce a false success response.

## Authorization and safety

The tool requires the OAuth `mcp:control` scope and advertises that it changes
state. Resolve an uncertain device name with `home_assistant_get_states` or
confirm a known entity with `home_assistant_get_state` before setting it.

Automated tests use a local HTTP stub. Do not exercise this tool against the
live Home Assistant URL merely to verify deployment: doing so changes the
thermostat. A live test requires the user's explicit approval of both the
entity and target temperature.
