# bpmn-auto-layout-extended

[![CI](https://github.com/krasucki/bpmn-auto-layout-extended/actions/workflows/CI.yml/badge.svg)](https://github.com/krasucki/bpmn-auto-layout-extended/actions/workflows/CI.yml)

Extended fork of [bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) with support for collaborations, message flows, text annotations, groups, lanes, and sub-process expansion.

Create and layout the graphical representation of a BPMN diagram.

## Usage

This library works with [Node.js](https://nodejs.org/) and in the browser.

```javascript
import { layoutProcess } from 'bpmn-auto-layout-extended';

import diagramXML from './diagram.bpmn';

const diagramWithLayoutXML = await layoutProcess(diagramXML);

console.log(diagramWithLayoutXML);
```

### Options

```javascript
await layoutProcess(diagramXML, options);
```

| Option | Type | Default | Description |
|---|---|---|---|
| `expandSubProcesses` | `boolean` | `false` | Expand all sub-processes inline instead of leaving them collapsed |

## What this fork adds

* **All participants laid out** — all participants in a collaboration are positioned, not just the first.
* **Message flows** — message flows between participants are routed as orthogonal edges.
* **Text annotations and associations** — process-level and collaboration-level annotations are positioned above their associated element.
* **Groups** — group shapes are emitted around their member elements.
* **Lanes (swimlanes)** — when a process defines a `laneSet`, elements are reorganized into lane-specific row bands and `BPMNShape` DI entries are emitted for each lane. Works both inside collaborations and for standalone processes (a collaboration+participant wrapper is synthesized automatically). Elements not explicitly assigned to a lane are inferred from their connections.
* **Original participant gap preserved** — the gap between pool lanes from the input is carried over (capped at 100 px); annotations are accommodated by expanding the pool height.
* **Sub-process expand support** — collapsed sub-processes retain their inner layout so they can be expanded; use `expandSubProcesses: true` to expand them inline during layout.

## Resources

* [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)

## Build and Run

```sh
# install dependencies
npm install

# build and run tests
npm run all

# run example
npm start
```

## Test

We use snapshot testing to verify old and new layout attempts. A mismatch is indicated as a test failure.

```sh
# run tests
npm test

# inspect the results
npm run test:inspect

# run update snapshots
npm run test:update-snapshots
```

Add new test cases to [`test/fixtures`](./test/fixtures) and they will be picked up automatically.

To pass options to a fixture, create a sidecar `<fixture>.options.json` file next to it:

```
test/fixtures/my-diagram.bpmn
test/fixtures/my-diagram.bpmn.options.json  ← { "expandSubProcesses": true }
```

## License

MIT
