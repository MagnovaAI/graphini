// Modified from https://github.com/Yash-Singh1/monaco-mermaid/blob/main/index.ts

import type * as Monaco from 'monaco-editor';
import { commentRegex, mermaidKeywords as keywords } from '../diagram/mermaidHelpers';

export const initEditor = (monacoEditor: typeof Monaco): void => {
  monacoEditor.languages.register({ id: 'mermaid' });

  const configDirectiveHandler = [
    /^\s*%%(?={)/,
    {
      next: '@configDirective',
      nextEmbedded: 'javascript',
      token: 'string'
    }
  ] as Monaco.languages.IShortMonarchLanguageRule1;

  // Register a tokens provider for the mermaid language
  monacoEditor.languages.setMonarchTokensProvider('mermaid', {
    ...Object.entries(keywords)
      .map((entry) =>
        Object.fromEntries(
          Object.entries(entry[1]).map((deepEntry) => [
            entry[0] + deepEntry[0][0].toUpperCase() + deepEntry[0].slice(1),
            deepEntry[1]
          ])
        )
      )
      .reduce(
        (overallKeywords, nextKeyword) => ({
          ...overallKeywords,
          ...nextKeyword
        }),
        {}
      ),
    tokenizer: {
      c4Diagram: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [/\(/, { next: 'c4DiagramParenthesis', token: 'delimiter.bracket' }],
        [
          /[A-Z_a-z-][\w$]*/,
          {
            cases: {
              '@c4DiagramBlockKeywords': 'typeKeyword',
              '@c4DiagramKeywords': 'keyword',
              '@default': 'variable'
            }
          }
        ],
        [commentRegex, 'comment']
      ],
      c4DiagramParenthesis: [
        [/,/, 'delimiter.bracket'],
        [/\)/, { next: '@pop', token: 'delimiter.bracket' }],
        [/[^),]/, 'string']
      ],
      classDiagram: [
        configDirectiveHandler,
        [/(^\s*(?:title|accDescription))(\s+.*$)/, ['keyword', 'string']],
        [
          /(\*|<\|?|o|)(--|\.\.)(\*|\|?>|o|)([\t ]*[A-Za-z]+[\t ]*)(:)(.*?$)/,
          ['transition', 'transition', 'transition', 'variable', 'delimiter.bracket', 'string']
        ],
        [/(?!class\s)([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']],
        [/(\*|<\|?|o)?(--|\.\.)(\*|\|?>|o)?/, 'transition'],
        [/^\s*class\s(?!.*{)/, 'keyword'],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@classDiagramBlockKeywords': 'typeKeyword',
              '@classDiagramKeywords': 'keyword',
              '@default': 'variable'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/(<<)(.+?)(>>)/, ['delimiter.bracket', 'annotation', 'delimiter.bracket']],
        [/".*?"/, 'string'],
        [/:::/, 'transition'],
        [/:|\+|-|#|~|\*\s*$|\$\s*$|\(|\)|{|}/, 'delimiter.bracket']
      ],
      configDirective: [[/%%$/, { next: '@pop', nextEmbedded: '@pop', token: 'string' }]],
      erDiagram: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [/[|}][o|](--|\.\.)[o|][{|]/, 'transition'],
        [/".*?"/, 'string'],
        [/(:)(.*?$)/, ['delimiter.bracket', 'string']],
        [/[:{}]/, 'delimiter.bracket'],
        [/([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']],
        [commentRegex, 'comment'],
        [/[A-Z_a-z-][\w$]*/, 'variable']
      ],
      flowchart: [
        configDirectiveHandler,
        [/[ox]?(--+|==+)[ox]/, 'transition'],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@flowchartBlockKeywords': 'typeKeyword',
              '@flowchartKeywords': 'keyword'
            }
          }
        ],
        [/\|+.+?\|+/, 'string'],
        [/\[+(\\.+?[/\\]|\/.+?[/\\])]+/, 'string'],
        [/[>[]+[^[\]|]+?]+/, 'string'],
        [/{+.+?}+/, 'string'],
        [/\(+.+?\)+/, 'string'],
        [/-\.+->?/, 'transition'],
        [/(-[.-])([^>-][^-]+?)(-{3,}|-{2,}>|\.-+>)/, ['transition', 'string', 'transition']],
        [/(==+)([^=]+?)(={3,}|={2,}>)/, ['transition', 'string', 'transition']],
        [/<?(--+|==+)>|===+|---+/, 'transition'],
        [/:::/, 'transition'],
        [/[&;]/, 'delimiter.bracket'],
        [/".*?"/, 'string'],
        [commentRegex, 'comment']
      ],
      gantt: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(section)(.*)/, ['typeKeyword', 'string']],
        [/^\s*([^\n:]*?)(:)/, ['string', 'delimiter.bracket']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@ganttBlockKeywords': 'typeKeyword',
              '@ganttKeywords': 'keyword'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/:/, 'delimiter.bracket']
      ],
      gitGraph: [
        configDirectiveHandler,
        [/option(?=s)/, { next: 'optionsGitGraph', token: 'typeKeyword' }],
        [/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter.bracket', 'string']],
        [
          /(^\s*branch)(.*?)(\s+order)(:\s*)(\d+\s*$)/,
          ['keyword', 'variable', 'keyword', 'delimiter.bracket', 'number']
        ],
        [/".*?"/, 'string'],
        [
          /(^\s*)(branch|reset|merge|checkout)(\s*\S+)/m,
          ['delimiter.bracket', 'keyword', 'variable']
        ],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@gitGraphBlockKeywords': 'typeKeyword',
              '@gitGraphKeywords': 'keyword'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/\^/, 'delimiter.bracket']
      ],
      info: [
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@infoBlockKeywords': 'typeKeyword',
              '@infoKeywords': 'keyword'
            }
          }
        ]
      ],
      journey: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(section)(.*)/, ['typeKeyword', 'string']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@journeyBlockKeywords': 'typeKeyword',
              '@journeyKeywords': 'keyword'
            }
          }
        ],
        [
          /(^\s*.+?)(:)(.*?)(:)(.*?)([$,])/,
          [
            'string',
            'delimiter.bracket',
            'number',
            'delimiter.bracket',
            'variable',
            'delimiter.bracket'
          ]
        ],
        [/,/, 'delimiter.bracket'],
        [/(^\s*.+?)(:)([^:]*?)$/, ['string', 'delimiter.bracket', 'variable']],
        [commentRegex, 'comment']
      ],
      optionsGitGraph: [
        [
          /s$/,
          {
            nextEmbedded: 'json',
            token: 'typeKeyword'
          }
        ],
        ['end', { next: '@pop', nextEmbedded: '@pop', token: 'typeKeyword' }]
      ],
      pie: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@pieBlockKeywords': 'typeKeyword',
              '@pieKeywords': 'keyword'
            }
          }
        ],
        [/".*?"/, 'string'],
        [/\s*\d+/, 'number'],
        [/:/, 'delimiter.bracket'],
        [commentRegex, 'comment']
      ],
      requirementDiagram: [
        configDirectiveHandler,
        [/->|<-|-/, 'transition'],
        [/(\d+\.)*\d+/, 'number'],
        [
          /[A-Z_a-z-][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@requirementDiagramBlockKeywords': 'typeKeyword'
            }
          }
        ],
        [/[/:{}]/, 'delimiter.bracket'],
        [commentRegex, 'comment'],
        [/".*?"/, 'string']
      ],
      root: [
        [/^\s*gitGraph/m, 'typeKeyword', 'gitGraph'],
        [/^\s*info/m, 'typeKeyword', 'info'],
        [/^\s*pie/m, 'typeKeyword', 'pie'],
        [/^\s*(flowchart|flowchart-v2|graph)/m, 'typeKeyword', 'flowchart'],
        [/^\s*sequenceDiagram/, 'typeKeyword', 'sequenceDiagram'],
        [/^\s*classDiagram(-v2)?/, 'typeKeyword', 'classDiagram'],
        [/^\s*journey/, 'typeKeyword', 'journey'],
        [/^\s*gantt/, 'typeKeyword', 'gantt'],
        [/^\s*stateDiagram(-v2)?/, 'typeKeyword', 'stateDiagram'],
        [/^\s*er(Diagram)?/, 'typeKeyword', 'erDiagram'],
        [/^\s*requirement(Diagram)?/, 'typeKeyword', 'requirementDiagram'],
        [/^\s*sankey-beta/m, 'typeKeyword', 'sankey'],
        [
          /^\s*(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/m,
          'typeKeyword',
          'c4Diagram'
        ],
        configDirectiveHandler,
        [/%%[^${].*$/, 'comment']
      ],
      sankey: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter.bracket', 'string']],
        [/".*?"/, 'string'],
        [/[A-Za-z]+/, 'string'],
        [/\s*\d+/, 'number'],
        [/,/, 'delimiter.bracket'],
        [commentRegex, 'comment']
      ],
      sequenceDiagram: [
        configDirectiveHandler,
        [/(title:?|accDescription)([^\n\r;]*$)/, ['keyword', 'string']],
        [/(autonumber)([^\S\n\r]+off[^\S\n\r]*$)/, ['keyword', 'keyword']],
        [/(autonumber)((?:[^\S\n\r]+\d+){2}[^\S\n\r]*$)/, ['keyword', 'number']],
        [/(autonumber)([^\S\n\r]+\d+[^\S\n\r]*$)/, ['keyword', 'number']],
        [
          /(link\s+)(.*?)(:)(\s*.*?)(\s*@)(\s*[^\n\r;]+)/,
          ['keyword', 'variable', 'delimiter.bracket', 'string', 'delimiter.bracket', 'string']
        ],
        [
          /((?:links|properties)\s+)([^\n\r:]*?)(:\s+)/,
          [
            { token: 'keyword' },
            { token: 'variable' },
            {
              next: '@sequenceDiagramLinksProps',
              nextEmbedded: 'javascript',
              token: 'delimiter.bracket'
            }
          ]
        ],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@sequenceDiagramBlockKeywords': 'typeKeyword',
              '@sequenceDiagramKeywords': 'keyword'
            }
          }
        ],
        [/(--?>?>|--?[)x])[+-]?/, 'transition'],
        [/(:)([^\n:]*?$)/, ['delimiter.bracket', 'string']],
        [commentRegex, 'comment']
      ],
      sequenceDiagramLinksProps: [
        // [/^:/, { token: 'delimiter.bracket', nextEmbedded: 'json' }],
        [/$|;/, { next: '@pop', nextEmbedded: '@pop', token: 'delimiter.bracket' }]
      ],
      stateDiagram: [
        configDirectiveHandler,
        [/note[^:]*$/, { next: 'stateDiagramNote', token: 'typeKeyword' }],
        ['hide empty description', 'keyword'],
        [/^\s*state\s(?!.*{)/, 'keyword'],
        [/(<<)(fork|join|choice)(>>)/, 'annotation'],
        [/(\[\[)(fork|join|choice)(]])/, ['delimiter.bracket', 'annotation', 'delimiter.bracket']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@stateDiagramBlockKeywords': 'typeKeyword',
              '@stateDiagramKeywords': 'keyword'
            }
          }
        ],
        [/".*?"/, 'string'],
        [/(:)([^\n:]*?$)/, ['delimiter.bracket', 'string']],
        [/{|}/, 'delimiter.bracket'],
        [commentRegex, 'comment'],
        [/-->/, 'transition'],
        [/\[.*?]/, 'string']
      ],
      stateDiagramNote: [
        [/^\s*end note$/, { next: '@pop', token: 'typeKeyword' }],
        [/.*/, 'string']
      ]
    }
  });

  // Enhanced Vercel-style dark theme
  monacoEditor.editor.defineTheme('mermaid-dark', {
    base: 'vs-dark',
    colors: {
      'editor.background': '#111113',
      'editor.foreground': '#ededed',
      'editor.lineHighlightBackground': '#111113',
      'editor.selectionBackground': '#262626',
      'editor.inactiveSelectionBackground': '#1a1a1a',
      'editorCursor.foreground': '#ededed',
      'editorWhitespace.foreground': '#404040',
      'editorIndentGuide.background': '#262626',
      'editorIndentGuide.activeBackground': '#404040',
      'editorLineNumber.foreground': '#404040',
      'editorLineNumber.activeForeground': '#ededed',
      'editorWidget.background': '#111113',
      'editorWidget.border': '#262626',
      'editorSuggestWidget.background': '#111113',
      'editorSuggestWidget.border': '#262626',
      'editorSuggestWidget.foreground': '#ededed',
      'editorSuggestWidget.selectedBackground': '#262626',
      'editorHoverWidget.background': '#111113',
      'editorHoverWidget.border': '#262626'
    },
    inherit: false,
    rules: [
      // VS Code Dark+ palette tuned for Mermaid (no # in foreground per Monaco spec)
      { foreground: '569CD6', token: 'keyword' },
      { fontStyle: 'bold', foreground: 'C586C0', token: 'typeKeyword' },
      { foreground: 'D16969', token: 'transition' },
      { foreground: '9CDCFE', token: 'variable' },
      { foreground: '4EC9B0', token: 'type' },
      { foreground: 'CE9178', token: 'string' },
      { foreground: 'B5CEA8', token: 'number' },
      { foreground: 'DCDCAA', token: 'annotation' },
      { fontStyle: 'italic', foreground: '6A9955', token: 'comment' },
      { foreground: 'FFD700', token: 'delimiter.bracket' },
      { foreground: '9CDCFE', token: 'identifier' },
      { fontStyle: 'bold', foreground: 'F44747', token: 'custom-error' }
    ]
  });

  // VS Code Light+ theme
  monacoEditor.editor.defineTheme('mermaid', {
    base: 'vs',
    colors: {
      'editor.background': '#fcfcfc',
      'editor.foreground': '#0a0a0a',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editor.selectionBackground': '#e5e5e5',
      'editor.inactiveSelectionBackground': '#f5f5f5',
      'editorCursor.foreground': '#0a0a0a',
      'editorWhitespace.foreground': '#d4d4d4',
      'editorIndentGuide.background': '#e5e5e5',
      'editorIndentGuide.activeBackground': '#d4d4d4',
      'editorLineNumber.foreground': '#d4d4d4',
      'editorLineNumber.activeForeground': '#0a0a0a',
      'editorWidget.background': '#fcfcfc',
      'editorWidget.border': '#e5e5e5',
      'editorSuggestWidget.background': '#fcfcfc',
      'editorSuggestWidget.border': '#e5e5e5',
      'editorSuggestWidget.foreground': '#0a0a0a',
      'editorSuggestWidget.selectedBackground': '#e5e5e5',
      'editorHoverWidget.background': '#fcfcfc',
      'editorHoverWidget.border': '#e5e5e5'
    },
    inherit: false,
    rules: [
      // VS Code Light+ palette tuned for Mermaid (no # in foreground per Monaco spec)
      { foreground: '0000FF', token: 'keyword' },
      { fontStyle: 'bold', foreground: 'AF00DB', token: 'typeKeyword' },
      { foreground: 'D16969', token: 'transition' },
      { foreground: '001080', token: 'variable' },
      { foreground: '267F99', token: 'type' },
      { foreground: 'A31515', token: 'string' },
      { foreground: '098658', token: 'number' },
      { foreground: '795E26', token: 'annotation' },
      { fontStyle: 'italic', foreground: '008000', token: 'comment' },
      { foreground: '0431FA', token: 'delimiter.bracket' },
      { foreground: '001080', token: 'identifier' },
      { fontStyle: 'bold', foreground: 'A31515', token: 'custom-error' }
    ]
  });

  monacoEditor.languages.registerCompletionItemProvider('mermaid', {
    provideCompletionItems: () => {
      return {
        suggestions: []
      };
    }
  });

  monacoEditor.languages.setLanguageConfiguration('mermaid', {
    autoClosingPairs: [
      {
        close: ')',
        open: '('
      },
      {
        close: '}',
        open: '{'
      },
      {
        close: ']',
        open: '['
      }
    ],
    brackets: [
      ['(', ')'],
      ['{', '}'],
      ['[', ']']
    ],
    comments: {
      lineComment: '%%'
    }
  });
};
