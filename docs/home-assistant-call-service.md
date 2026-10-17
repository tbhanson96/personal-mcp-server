# Allowlisted Home Assistant service calls

`home_assistant_call_service` exposes a standard Home Assistant service-call
shape without exposing an unrestricted API passthrough. It requires `domain`,
`service`, and `entity_id`, accepts optional JSON `service_data`, and requires
the `mcp:control` OAuth scope.

The current server-side allowlist contains exactly one operation:

| Domain | Service | Entity |
| --- | --- | --- |
| `climate` | `turn_on` | `climate.tim_s_model_y_climate` |

Every other domain/service/entity combination is rejected before an HTTP
request is made. This includes locks, garage and other covers, alarm control
panels, security devices, scripts, scenes, and automations. Target selectors
(`entity_id`, `device_id`, `area_id`, and `target`) are also forbidden inside
`service_data`; the validated top-level `entity_id` is always used.

Example arguments:

```json
{
  "domain": "climate",
  "service": "turn_on",
  "entity_id": "climate.tim_s_model_y_climate",
  "service_data": {}
}
```

This call changes a real device and should be made only for an explicit user
request. Tests use a loopback HTTP stub and never contact the configured Home
Assistant instance or turn on vehicle climate.

To support another operation, add the exact service/entity combination to
`CALL_SERVICE_ALLOWLIST`, assess indirect effects (especially scripts, scenes,
automations, switches, locks, covers, alarms, and security integrations), add
both allowed and denied tests, and update this document. Do not replace the
allowlist with a denylist: new Home Assistant integrations and services must
remain denied by default.
