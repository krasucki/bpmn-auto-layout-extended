import { BpmnModdle } from 'bpmn-moddle';
import { isBoundaryEvent, isConnection } from './utils/elementUtils.js';
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH, getMid, getDockingPoint } from './utils/layoutUtil.js';

const PARTICIPANT_LABEL_WIDTH = 30;
import { Grid } from './Grid.js';
import { DiFactory } from './di/DiFactory.js';
import { is, getDefaultSize } from './di/DiUtil.js';
import { handlers } from './handler/index.js';
import { isFunction } from 'min-dash';

export class Layouter {
  constructor() {
    this.moddle = new BpmnModdle();
    this.diFactory = new DiFactory(this.moddle);
    this._handlers = handlers;
  }

  handle(operation, options) {
    return this._handlers
      .filter(handler => isFunction(handler[operation]))
      .map(handler => handler[operation](options));

  }

  async layoutProcess(xml, options = {}) {
    const moddleObj = await this.moddle.fromXML(xml);
    const { rootElement } = moddleObj;

    this.diagram = rootElement;

    const collaboration = this.getCollaboration();

    if (collaboration) {
      this.setExpandedPropertyToModdleElements(moddleObj, options);
      const participantGap = this.readParticipantGap(collaboration);
      this.cleanDi();
      this.layoutCollaboration(collaboration, { ...options, participantGap });
    } else {
      const firstRootProcess = this.getProcess();

      if (firstRootProcess) {
        this.setExpandedPropertyToModdleElements(moddleObj, options);
        this.setExecutedProcesses(firstRootProcess);
        this.createGridsForProcesses();
        this.cleanDi();
        this.createRootDi(firstRootProcess);
        this.drawProcesses();

        // Draw artifacts and data associations for each laid out process
        for (const process of this.layoutedProcesses) {
          const diagram = this.diagram.diagrams.find(d => d.plane.bpmnElement === process)
            || this.diagram.diagrams[0];
          this.generateArtifactsDi(process, diagram);
          this.generateDataAssociationsDi(process, diagram);
        }
      }
    }

    return (await this.moddle.toXML(this.diagram, { format: true })).xml;
  }

  layoutCollaboration(collaboration, options = {}) {
    const PARTICIPANT_GAP = options.participantGap ?? 0;

    // Build grids per participant's process
    const participantLayouts = collaboration.participants.map(participant => {
      const process = participant.processRef;
      if (!process) return { participant, process: null, layoutedProcesses: [], grid: null };

      this.layoutedProcesses = [];
      this.setExecutedProcesses(process);
      this.createGridsForProcesses();

      return {
        participant,
        process,
        layoutedProcesses: [ ...this.layoutedProcesses ],
        grid: process.grid
      };
    });

    // Create single collaboration diagram
    const collaborationDi = this.createCollaborationDi(collaboration);

    const participantFloors = new Map();
    let currentY = 0;

    for (const { participant, process, layoutedProcesses, grid } of participantLayouts) {
      if (process) participantFloors.set(process, currentY);

      let participantWidth, participantHeight;

      if (!grid) {
        participantWidth = 400;
        participantHeight = DEFAULT_CELL_HEIGHT;
      } else {
        const [ rows, cols ] = grid.getGridDimensions();
        participantWidth = PARTICIPANT_LABEL_WIDTH + Math.max(cols, 1) * DEFAULT_CELL_WIDTH;
        participantHeight = Math.max(rows, 1) * DEFAULT_CELL_HEIGHT;
      }

      // Compute extra top padding needed for collaboration-level annotations
      const annotationPadding = grid
        ? this.computeAnnotationPadding(collaboration, process, grid)
        : 0;

      participantHeight += annotationPadding;

      // Emit participant shape
      const participantShape = this.diFactory.createDiShape(participant, {
        x: 0,
        y: currentY,
        width: participantWidth,
        height: participantHeight
      }, {
        id: participant.id + '_di',
        isHorizontal: true
      });
      collaborationDi.plane.get('planeElement').push(participantShape);
      participant.di = participantShape;

      if (grid) {

        // Draw flow elements with participant offset (shifted down by annotation padding)
        const shift = { x: PARTICIPANT_LABEL_WIDTH, y: currentY + annotationPadding };
        this.generateDi(grid, shift, collaborationDi);

        // Draw expanded sub-processes within this participant
        this.layoutedProcesses = layoutedProcesses;
        this.drawExpandedProcesses(collaborationDi);

        // Draw artifacts (text annotations, associations, groups) and data associations
        this.generateArtifactsDi(process, collaborationDi);
        this.generateDataAssociationsDi(process, collaborationDi);
      }

      currentY += participantHeight + PARTICIPANT_GAP;
    }

    // Collaboration-level artifacts (annotations, associations, groups)
    this.generateArtifactsDi(collaboration, collaborationDi, {
      getAnnotationFloor: (peer) => {
        for (const [ proc, floorY ] of participantFloors) {
          if (containsElement(proc, peer)) return floorY;
        }
        return -Infinity;
      }
    });

    // Message flows after all participants are positioned
    this.generateMessageFlowsDi(collaboration, collaborationDi);
  }

  drawExpandedProcesses(targetDi) {
    const expandedProcesses = this.layoutedProcesses
      .filter(p => p.isExpanded)
      .sort((a, b) => a.level - b.level);

    for (const process of expandedProcesses) {
      const baseProcDi = this.getElementDi(process);
      if (!baseProcDi) continue;
      const diagram = this.getProcDi(baseProcDi) || targetDi;
      let { x, y } = baseProcDi.bounds;
      const { width, height } = getDefaultSize(process);
      x += DEFAULT_CELL_WIDTH / 2 - width / 4;
      y += DEFAULT_CELL_HEIGHT - height - height / 4;
      this.generateDi(process.grid, { x, y }, diagram);
    }
  }

  generateArtifactsDi(process, procDi, options = {}) {
    const { getAnnotationFloor = () => -Infinity } = options;
    const artifacts = process.artifacts || [];
    const planeElement = procDi.plane.get('planeElement');

    const textAnnotations = artifacts.filter(a => is(a, 'bpmn:TextAnnotation'));
    const associations = artifacts.filter(a => is(a, 'bpmn:Association'));
    const groups = artifacts.filter(a => is(a, 'bpmn:Group'));

    // Position text annotations above their associated source element
    textAnnotations.forEach(annotation => {
      const association = associations.find(
        assoc => assoc.targetRef === annotation || assoc.sourceRef === annotation
      );

      if (!association) return;

      const peer = association.sourceRef === annotation
        ? association.targetRef
        : association.sourceRef;

      if (!peer || !peer.di) return;

      const peerBounds = peer.di.get('bounds');
      const { width, height } = getDefaultSize(annotation);
      const candidateY = peerBounds.y - height - 20;
      const floor = getAnnotationFloor(peer);
      const x = peerBounds.x;
      const y = floor > -Infinity ? Math.max(candidateY, floor + 5) : candidateY;

      const shapeDi = this.diFactory.createDiShape(annotation, { x, y, width, height }, {
        id: annotation.id + '_di'
      });
      annotation.di = shapeDi;
      planeElement.push(shapeDi);
    });

    // Emit association edges
    associations.forEach(association => {
      const source = association.sourceRef;
      const target = association.targetRef;

      if (!source || !target || !source.di || !target.di) return;

      const sourceBounds = source.di.get('bounds');
      const targetBounds = target.di.get('bounds');
      const sourceMid = getMid(sourceBounds);
      const targetMid = getMid(targetBounds);

      const annotationIsSource = is(source, 'bpmn:TextAnnotation');
      const edgeDi = this.diFactory.createDiEdge(association, [
        getDockingPoint(sourceMid, sourceBounds, annotationIsSource ? 'b' : 't'),
        getDockingPoint(targetMid, targetBounds, annotationIsSource ? 't' : 'b')
      ], {
        id: association.id + '_di'
      });
      planeElement.push(edgeDi);
    });

    // Groups — handled after associations
    this.generateGroupsDi(groups, process, planeElement);
  }

  generateGroupsDi(groups, process, planeElement) {
    const PADDING = 20;
    const flowElements = process.flowElements || [];

    groups.forEach(group => {
      const categoryValue = group.categoryValueRef;
      if (!categoryValue) return;

      // Find flow elements whose categoryValueRef array includes this group's categoryValue
      const members = flowElements.filter(el =>
        Array.isArray(el.categoryValueRef) && el.categoryValueRef.includes(categoryValue)
      );
      const memberBounds = members
        .filter(el => el.di)
        .map(el => el.di.get('bounds'));

      if (memberBounds.length === 0) return;

      const minX = Math.min(...memberBounds.map(b => b.x)) - PADDING;
      const minY = Math.min(...memberBounds.map(b => b.y)) - PADDING;
      const maxX = Math.max(...memberBounds.map(b => b.x + b.width)) + PADDING;
      const maxY = Math.max(...memberBounds.map(b => b.y + b.height)) + PADDING;

      const shapeDi = this.diFactory.createDiShape(group, {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      }, {
        id: group.id + '_di'
      });
      planeElement.push(shapeDi);
    });
  }

  generateMessageFlowsDi(collaboration, collaborationDi) {
    const messageFlows = collaboration.messageFlows || [];
    const planeElement = collaborationDi.plane.get('planeElement');

    messageFlows.forEach(messageFlow => {
      const source = messageFlow.sourceRef;
      const target = messageFlow.targetRef;

      if (!source || !target || !source.di || !target.di) return;

      const sourceBounds = source.di.get('bounds');
      const targetBounds = target.di.get('bounds');
      const sourceMid = getMid(sourceBounds);
      const targetMid = getMid(targetBounds);

      const sourceIsAbove = sourceBounds.y < targetBounds.y;

      const sourceExitY = sourceIsAbove
        ? sourceBounds.y + sourceBounds.height
        : sourceBounds.y;
      const targetEntryY = sourceIsAbove
        ? targetBounds.y
        : targetBounds.y + targetBounds.height;
      const midY = (sourceExitY + targetEntryY) / 2;

      // Orthogonal routing: exit source vertically, jog horizontally at midpoint, enter target vertically
      const edgeDi = this.diFactory.createDiEdge(messageFlow, [
        { x: sourceMid.x, y: sourceExitY },
        { x: sourceMid.x, y: midY },
        { x: targetMid.x, y: midY },
        { x: targetMid.x, y: targetEntryY }
      ], {
        id: messageFlow.id + '_di'
      });

      planeElement.push(edgeDi);
    });
  }

  generateDataAssociationsDi(process, procDi) {
    const flowElements = process.flowElements || [];
    const planeElement = procDi.plane.get('planeElement');

    flowElements.forEach(element => {
      (element.dataInputAssociations || []).forEach(association => {
        const sources = association.sourceRef || [];
        sources.forEach((source, i) => {
          if (!source.di || !element.di) return;
          const id = sources.length > 1
            ? `${association.id}_src${i}_di`
            : `${association.id}_di`;
          const edgeDi = this.diFactory.createDiEdge(association,
            orthogonalConnect(source.di.get('bounds'), element.di.get('bounds')),
            { id });
          planeElement.push(edgeDi);
        });
      });

      (element.dataOutputAssociations || []).forEach(association => {
        const target = association.targetRef;
        if (!target || !target.di || !element.di) return;
        const edgeDi = this.diFactory.createDiEdge(association,
          orthogonalConnect(element.di.get('bounds'), target.di.get('bounds')),
          { id: association.id + '_di' });
        planeElement.push(edgeDi);
      });
    });
  }

  createGridsForProcesses() {
    const processes = this.layoutedProcesses.sort((a, b) => b.level - a.level);

    // create and add grids for each process
    // root processes should be processed last for element expanding
    for (const process of processes) {

      // add base grid with collapsed elements
      process.grid = this.createGridLayout(process);

      expandGridHorizontally(process.grid);
      expandGridVertically(process.grid);

      if (process.isExpanded) {
        const [ rowCount, colCount ] = process.grid.getGridDimensions();
        if (rowCount === 0) process.grid.createRow();
        if (colCount === 0) process.grid.createCol();
      }

    }
  }

  setExpandedPropertyToModdleElements(bpmnModel, options = {}) {
    const allElements = bpmnModel.elementsById;
    if (allElements) {
      for (const element of Object.values(allElements)) {
        if (element.$type === 'bpmndi:BPMNShape' && element.isExpanded === true) element.bpmnElement.isExpanded = true;
      }

      // Sub-processes with a dedicated BPMNDiagram are expanded
      for (const element of Object.values(allElements)) {
        if (element.$type === 'bpmn:SubProcess') {
          const hasSeparateDiagram = this.diagram.diagrams.some(d => d.plane && d.plane.bpmnElement === element);
          if (hasSeparateDiagram) element.isExpanded = true;
        }
      }

      if (options.expandSubProcesses) {
        for (const element of Object.values(allElements)) {
          if (element.$type === 'bpmn:SubProcess') {
            element.isExpanded = true;
          }
        }
      }
    }
  }

  setExecutedProcesses(firstRootProcess) {
    this.layoutedProcesses = [];

    const executionStack = [ firstRootProcess ];

    while (executionStack.length > 0) {
      const executedProcess = executionStack.pop();
      this.layoutedProcesses.push(executedProcess);
      executedProcess.level = executedProcess.$parent === this.diagram ? 0 : executedProcess.$parent.level + 1;

      const nextProcesses = executedProcess.flowElements?.filter(flowElement => flowElement.$type === 'bpmn:SubProcess') || [];

      executionStack.splice(executionStack.length, 0, ...nextProcesses);
    }
  }

  cleanDi() {
    this.diagram.diagrams = [];
  }

  createGridLayout(root) {
    const grid = new Grid();

    const flowElements = root.flowElements || [];
    const elements = flowElements.filter(el => !is(el,'bpmn:SequenceFlow'));

    // check for empty process/subprocess
    if (!flowElements) {
      return grid;
    }

    bindBoundaryEventsWithHosts (flowElements);

    // Depth-first-search
    const visited = new Set();
    while (visited.size < elements.filter(element => !element.attachedToRef).length) {
      const startingElements = flowElements.filter(el => {
        return !isConnection(el) &&
            !isBoundaryEvent(el) &&
            (!el.incoming || !hasOtherIncoming(el)) &&
            !visited.has(el);
      });

      const stack = [ ...startingElements ];

      startingElements.forEach(el => {
        grid.add(el);
        visited.add(el);
      });

      this.handleGrid(grid,visited,stack);

      if (grid.getElementsTotal() !== elements.length) {
        const gridElements = grid.getAllElements();
        const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el));
        if (missingElements.length > 0) {
          stack.push(missingElements[0]);
          grid.add(missingElements[0]);
          visited.add(missingElements[0]);
          this.handleGrid(grid,visited,stack);
        }
      }
    }
    return grid;
  }

  generateDi(layoutGrid , shift, procDi) {
    const diFactory = this.diFactory;

    const prePlaneElement = procDi ? procDi : this.diagram.diagrams[0];

    const planeElement = prePlaneElement.plane.get('planeElement');

    // Step 1: Create DI for all elements
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createElementDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });

    // Step 2: Create DI for all connections
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createConnectionDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });
  }

  handleGrid(grid, visited, stack) {
    while (stack.length > 0) {
      const currentElement = stack.pop();

      const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, stack });

      nextElements.flat().forEach(el => {
        stack.push(el);
        visited.add(el);
      });
    }
  }

  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }

  getCollaboration() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Collaboration');
  }

  computeAnnotationPadding(collaboration, process, grid) {
    const artifacts = collaboration.artifacts || [];
    const associations = artifacts.filter(a => is(a, 'bpmn:Association'));
    const textAnnotations = artifacts.filter(a => is(a, 'bpmn:TextAnnotation'));
    const processElements = new Set(process.flowElements || []);
    const elementsByPos = grid.elementsByPosition();

    let padding = 0;

    textAnnotations.forEach(annotation => {
      const association = associations.find(
        assoc => assoc.targetRef === annotation || assoc.sourceRef === annotation
      );
      if (!association) return;

      const peer = association.sourceRef === annotation
        ? association.targetRef
        : association.sourceRef;

      if (!peer || !processElements.has(peer)) return;

      const pos = elementsByPos.find(({ element }) => element === peer);
      if (!pos) return;

      const { height: annotHeight } = getDefaultSize(annotation);
      const { height: peerHeight } = getDefaultSize(peer);
      const relativePeerY = pos.row * DEFAULT_CELL_HEIGHT + (DEFAULT_CELL_HEIGHT - peerHeight) / 2;
      const relativeCandidateY = relativePeerY - annotHeight - 20;

      if (relativeCandidateY < 5) {
        padding = Math.max(padding, 5 - relativeCandidateY);
      }
    });

    return padding;
  }

  readParticipantGap(collaboration) {
    const participants = collaboration.participants;
    if (participants.length < 2) return 0;

    const shapes = this.diagram.diagrams
      .flatMap(d => d.plane.planeElement)
      .filter(el => el.$type === 'bpmndi:BPMNShape' && participants.includes(el.bpmnElement));

    if (shapes.length < 2) return 0;

    shapes.sort((a, b) => a.bounds.y - b.bounds.y);

    let gap = 0;
    for (let i = 1; i < shapes.length; i++) {
      const prevBottom = shapes[i - 1].bounds.y + shapes[i - 1].bounds.height;
      gap = Math.max(gap, shapes[i].bounds.y - prevBottom);
    }
    return Math.min(gap, 100);
  }

  createCollaborationDi(collaboration) {
    const diFactory = this.diFactory;
    const planeDi = diFactory.createDiPlane({
      id: 'BPMNPlane_' + collaboration.id,
      bpmnElement: collaboration
    });
    const diagramDi = diFactory.createDiDiagram({
      id: 'BPMNDiagram_' + collaboration.id,
      plane: planeDi
    });
    this.diagram.diagrams.push(diagramDi);
    return diagramDi;
  }

  createRootDi(processes) {
    this.createProcessDi(processes);
  }

  createProcessDi(element) {
    const diFactory = this.diFactory;

    const planeDi = diFactory.createDiPlane({
      id: 'BPMNPlane_' + element.id,
      bpmnElement: element
    });
    const diagramDi = diFactory.createDiDiagram({
      id: 'BPMNDiagram_' + element.id,
      plane: planeDi
    });

    const diagram = this.diagram;

    diagram.diagrams.push(diagramDi);

    return diagramDi;
  }

  /**
   * Draw processes.
   * Root processes should be processed first for element expanding
   */
  drawProcesses() {
    const sortedProcesses = this.layoutedProcesses.sort((a, b) => a.level - b.level);

    for (const process of sortedProcesses) {

      // draw processes in expanded elements
      if (process.isExpanded) {
        const baseProcDi = this.getElementDi(process);
        const diagram = this.getProcDi(baseProcDi);
        let { x, y } = baseProcDi.bounds;
        const { width, height } = getDefaultSize(process);
        x += DEFAULT_CELL_WIDTH / 2 - width / 4;
        y += DEFAULT_CELL_HEIGHT - height - height / 4;
        this.generateDi(process.grid, { x, y }, diagram);
        continue;
      }

      // draw other processes (collapsed sub-processes have no separate diagram)
      const diagram = this.diagram.diagrams.find(diagram => diagram.plane.bpmnElement === process);
      if (!diagram) continue;
      this.generateDi(process.grid, { x: 0, y: 0 }, diagram);
    }
  }

  getElementDi(element) {
    return this.diagram.diagrams
      .map(diagram => diagram.plane.planeElement).flat()
      .find(item => item.bpmnElement === element);
  }

  getProcDi(element) {
    return this.diagram.diagrams.find(diagram => diagram.plane.planeElement.includes(element));
  }
}

function containsElement(process, element) {
  const flowElements = process.flowElements || [];
  if (flowElements.includes(element)) return true;
  return flowElements.some(el => el.flowElements && containsElement(el, element));
}

export function bindBoundaryEventsWithHosts(elements) {
  const boundaryEvents = elements.filter(element => isBoundaryEvent(element));
  boundaryEvents.forEach(boundaryEvent => {
    const attachedTask = boundaryEvent.attachedToRef;
    const attachers = attachedTask.attachers || [];
    attachers.push(boundaryEvent);
    attachedTask.attachers = attachers;
  });
}

/**
 * Check grid by columns.
 * If column has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid horizontally.
 * @param grid
 */
function expandGridHorizontally(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();
  for (let i = maxCols - 1 ; i >= 0; i--) {
    const elementsInCol = [];
    for (let j = 0; j < numRows; j++) {
      const candidate = grid.get(j, i);
      if (candidate && candidate.isExpanded) elementsInCol.push(candidate);
    }

    if (elementsInCol.length === 0) continue;

    const maxColCount = elementsInCol.reduce((acc,cur) => {
      const [ ,curCols ] = cur.grid.getGridDimensions();
      if (acc === undefined || curCols > acc) return curCols;
      return acc;
    }, undefined);

    const shift = !maxColCount ? 2 : maxColCount;
    grid.createCol(i, shift);
  }
}

/**
 * Check grid by rows.
 * If row has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid vertically.
 * @param grid
 */
function expandGridVertically(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();

  for (let i = numRows - 1 ; i >= 0; i--) {
    const elementsInRow = [];
    for (let j = 0; j < maxCols; j++) {
      const candidate = grid.get(i, j);
      if (candidate && candidate.isExpanded) elementsInRow.push(candidate);
    }

    if (elementsInRow.length === 0) continue;

    const maxRowCount = elementsInRow.reduce((acc,cur) => {
      const [ curRows ] = cur.grid.getGridDimensions();
      if (acc === undefined || curRows > acc) return curRows;
      return acc;
    }, undefined);

    const shift = !maxRowCount ? 1 : maxRowCount;

    // expand the parent grid vertically
    for (let index = 0; index < shift; index++) {
      grid.createRow(i);
    }
  }
}

function orthogonalConnect(sourceBounds, targetBounds) {
  const sourceMid = getMid(sourceBounds);
  const targetMid = getMid(targetBounds);
  const sourceBelow = sourceBounds.y > targetBounds.y;
  const sourceExitY = sourceBelow ? sourceBounds.y : sourceBounds.y + sourceBounds.height;
  const targetEntryY = sourceBelow ? targetBounds.y + targetBounds.height : targetBounds.y;
  const midY = (sourceExitY + targetEntryY) / 2;
  return [
    { x: sourceMid.x, y: sourceExitY },
    { x: sourceMid.x, y: midY },
    { x: targetMid.x, y: midY },
    { x: targetMid.x, y: targetEntryY }
  ];
}

function hasOtherIncoming(element) {
  const fromHost = element.incoming?.filter(edge => edge.sourceRef !== element && edge.sourceRef.attachedToRef === undefined) || [];

  const fromAttached = element.incoming?.filter(edge => edge.sourceRef !== element
      && edge.sourceRef.attachedToRef !== element);

  return fromHost?.length > 0 || fromAttached?.length > 0;
}
