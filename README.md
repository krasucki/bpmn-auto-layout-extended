# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Create and layout the graphical representation of a BPMN diagram.

Try it out in [the example project](https://bpmn-io.github.io/bpmn-auto-layout/).

## Usage

This library works with [Node.js](https://nodejs.org/) and in the browser.

```javascript
import { layoutProcess } from 'bpmn-auto-layout';

import diagramXML from './diagram.bpmn';

const diagramWithLayoutXML = await layoutProcess(diagramXML);

console.log(diagramWithLayoutXML);
```

## Limitations

* Sub-processes are laid out as collapsed sub-processes by default (use `expandSubProcesses` option to expand)

## Fixes in this fork (branch: `limitations-fixes`)

This fork extends the upstream library with the following fixes:

* **All participants laid out** — upstream only laid out the first participant in a collaboration; all participants are now positioned.
* **Message flows** — message flows between participants are routed and emitted as orthogonal edges.
* **Text annotations and associations** — process-level and collaboration-level text annotations are now positioned above their associated element. Annotations with no association are silently skipped.
* **Groups** — group shapes are emitted around their member elements.
* **Collaboration-level artifacts** — text annotations attached to the collaboration (not a specific process) are now rendered correctly.
* **Original participant gap preserved** — the gap between pool lanes from the input diagram is carried over to the output (capped at 100 px). Annotations are accommodated by expanding the pool height rather than pushing pools apart.
* **Collapsed sub-process inner elements** — inner elements of a collapsed sub-process are no longer erroneously emitted into the parent plane.

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

## License

MIT
