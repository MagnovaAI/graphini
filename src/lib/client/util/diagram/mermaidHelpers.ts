/**
 * Mermaid language keyword definitions and token data.
 * Used by the Monaco editor language registration (monacoExtra.ts)
 * and potentially by other diagram-related utilities.
 */

/** Regex for matching Mermaid comments (%% ...) */
export const commentRegex = /(?<!["'])%%(?![^"']*["']\)).*$/;

/** Requirement diagram sub-types */
export const requirementDiagrams = [
  'requirement',
  'functionalRequirement',
  'interfaceRequirement',
  'performanceRequirement',
  'physicalRequirement',
  'designConstraint'
];

/** Keyword definitions for each Mermaid diagram type */
export const mermaidKeywords: Record<
  string,
  {
    typeKeywords: string[];
    blockKeywords: string[];
    keywords: string[];
  }
> = {
  c4Diagram: {
    blockKeywords: [
      'Boundary',
      'Enterprise_Boundary',
      'System_Boundary',
      'Container_Boundary',
      'Node',
      'Node_L',
      'Node_R'
    ],
    keywords: [
      'title',
      'accDescription',
      'direction',
      'TB',
      'BT',
      'RL',
      'LR',
      'Person_Ext',
      'Person',
      'SystemQueue_Ext',
      'SystemDb_Ext',
      'System_Ext',
      'SystemQueue',
      'SystemDb',
      'System',
      'ContainerQueue_Ext',
      'ContainerDb_Ext',
      'Container_Ext',
      'ContainerQueue',
      'ContainerDb',
      'Container',
      'ComponentQueue_Ext',
      'ComponentDb_Ext',
      'Component_Ext',
      'ComponentQueue',
      'ComponentDb',
      'Component',
      'Deployment_Node',
      'Rel',
      'BiRel',
      'Rel_Up',
      'Rel_U',
      'Rel_Down',
      'Rel_D',
      'Rel_Left',
      'Rel_L',
      'Rel_Right',
      'Rel_R',
      'Rel_Back',
      'RelIndex'
    ],
    typeKeywords: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']
  },
  classDiagram: {
    blockKeywords: ['class'],
    keywords: [
      'link',
      'click',
      'callback',
      'call',
      'href',
      'cssClass',
      'direction',
      'TB',
      'BT',
      'RL',
      'LR',
      'title',
      'accDescription',
      'order'
    ],
    typeKeywords: ['classDiagram', 'classDiagram-v2']
  },
  erDiagram: {
    blockKeywords: [],
    keywords: ['title', 'accDescription'],
    typeKeywords: ['erDiagram']
  },
  flowchart: {
    blockKeywords: ['subgraph', 'end'],
    keywords: [
      'TB',
      'TD',
      'BT',
      'RL',
      'LR',
      'click',
      'call',
      'href',
      '_self',
      '_blank',
      '_parent',
      '_top',
      'linkStyle',
      'style',
      'classDef',
      'class',
      'direction',
      'interpolate'
    ],
    typeKeywords: ['flowchart', 'flowchart-v2', 'graph']
  },
  gantt: {
    blockKeywords: [],
    keywords: [
      'title',
      'dateFormat',
      'axisFormat',
      'todayMarker',
      'section',
      'excludes',
      'inclusiveEndDates'
    ],
    typeKeywords: ['gantt']
  },
  gitGraph: {
    blockKeywords: [],
    keywords: [
      'accTitle',
      'accDescr',
      'commit',
      'cherry-pick',
      'branch',
      'merge',
      'reset',
      'checkout',
      'LR',
      'BT',
      'id',
      'msg',
      'type',
      'tag',
      'NORMAL',
      'REVERSE',
      'HIGHLIGHT'
    ],
    typeKeywords: ['gitGraph']
  },
  info: {
    blockKeywords: [],
    keywords: ['showInfo'],
    typeKeywords: ['info']
  },
  journey: {
    blockKeywords: ['section'],
    keywords: ['title'],
    typeKeywords: ['journey']
  },
  pie: {
    blockKeywords: [],
    keywords: ['showData', 'title', 'accDescr', 'accTitle'],
    typeKeywords: ['pie']
  },
  requirementDiagram: {
    blockKeywords: [...requirementDiagrams, 'element'],
    keywords: [],
    typeKeywords: ['requirement', 'requirementDiagram']
  },
  sankey: {
    blockKeywords: [],
    keywords: [],
    typeKeywords: ['sankey-beta']
  },
  sequenceDiagram: {
    blockKeywords: ['alt', 'par', 'and', 'loop', 'else', 'end', 'rect', 'opt', 'alt', 'rect'],
    keywords: [
      'participant',
      'as',
      'Note',
      'note',
      'right of',
      'left of',
      'over',
      'activate',
      'deactivate',
      'autonumber',
      'title',
      'actor',
      'accDescription',
      'link',
      'links'
    ],
    typeKeywords: ['sequenceDiagram']
  },
  stateDiagram: {
    blockKeywords: ['state', 'note', 'end'],
    keywords: ['state', 'as', 'hide empty description', 'direction', 'TB', 'BT', 'RL', 'LR'],
    typeKeywords: ['stateDiagram', 'stateDiagram-v2']
  }
};
