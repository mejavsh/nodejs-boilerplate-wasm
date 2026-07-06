> This is a very experimental port of Next boilerplate to use Vinext. This has not been tested apart from the basic functionality.

## Getting Started

Build the App

```bash
spin build
```

## Run the App 

```bash
# start the docker container for postgres
docker compose up
spin up
```

## Using Spin Interfaces

To use additional Spin interfaces, install the corresponding packages:

| Interface     | Package                         |
|---------------|---------------------------------|
| Key-Value     | `@spinframework/spin-kv`        |
| LLM           | `@spinframework/spin-llm`       |
| MQTT          | `@spinframework/spin-mqtt`      |
| MySQL         | `@spinframework/spin-mysql`     |
| PostgreSQL    | `@spinframework/spin-postgres`  |
| Redis         | `@spinframework/spin-redis`     |
| SQLite        | `@spinframework/spin-sqlite`    |
| Variables     | `@spinframework/spin-variables` |

## Using the StarlingMonkey Debugger for VS Code

1. First install the [StarlingMonkey Debugger](https://marketplace.visualstudio.com/items?itemName=BytecodeAlliance.starlingmonkey-debugger) extension.
2. Build the component using the debug command `npm run build:debug`.
3. Uncomment `tcp://127.0.0.1:*` in the `allowed_outbound_hosts` field in the `spin.toml`.
4. Start the debugger in VS Code which should start Spin and attach the debugger. The debugger needs to be restarted for each http call.