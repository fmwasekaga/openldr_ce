import type { NodeCategory, NodeTemplate, WorkflowNodeData } from './lib/types';

/**
 * Template ids whose handlers exist in SP-1. Everything else renders disabled
 * ("coming soon") in the palette until later slices add the handler.
 */
export const IMPLEMENTED_TEMPLATE_IDS = new Set<string>([
  // trigger
  'manual-trigger',
  // actions
  'set', 'log', 'merge',
  // conditions
  'if', 'filter',
]);

/**
 * Node library catalog — inspired by n8n's categorized node palette.
 *
 * Each entry has:
 *  - `type`: the ReactFlow node type ('trigger' | 'action' | 'condition' | 'loop' | 'code' | 'webhook').
 *  - `icon`: the lucide-react icon name used in the sidebar (used as default if defaultData.iconName is unset).
 *  - `defaultData.iconName`: propagated onto the rendered node on the canvas.
 *  - optional `iconUrl`: if you drop brand SVGs/PNGs into `apps/web/public/node-icons/`,
 *    set this to `/node-icons/<file>` and the sidebar + canvas node will use the real logo.
 *
 * To add a brand logo later: download e.g. `slack.svg` to `apps/web/public/node-icons/`
 * then set `iconUrl: '/node-icons/slack.svg'` on that template (and mirror it on defaultData).
 */

type NodeType = 'trigger' | 'action' | 'condition' | 'loop' | 'code' | 'webhook';

/**
 * Compact factory — builds a NodeTemplate whose defaultData carries the icon
 * metadata so the canvas node picks up the same visual as the sidebar card.
 */
function node(
  id: string,
  type: NodeType,
  label: string,
  icon: string,
  description: string,
  opts: {
    keywords?: string[];
    iconUrl?: string;
    subtitle?: string;
    /** Extra fields merged on top of the type-default defaultData. */
    data?: Partial<WorkflowNodeData>;
  } = {},
): NodeTemplate {
  const { keywords, iconUrl, subtitle, data: dataOverrides } = opts;

  let defaultData: WorkflowNodeData;
  switch (type) {
    case 'trigger':
      defaultData = {
        label,
        triggerType: 'manual',
        config: {},
        iconName: icon,
        iconUrl,
      };
      break;
    case 'webhook':
      defaultData = {
        label,
        path: '',
        url: '',
        method: 'POST',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'condition':
      defaultData = {
        label,
        condition: '',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'loop':
      defaultData = {
        label,
        iterations: 10,
        iconName: icon,
        iconUrl,
      };
      break;
    case 'code':
      defaultData = {
        label,
        code: '// Write your code here\nreturn {};',
        language: 'javascript',
        iconName: icon,
        iconUrl,
      };
      break;
    case 'action':
    default:
      defaultData = {
        label,
        action: subtitle ?? id,
        config: {},
        iconName: icon,
        iconUrl,
      };
      break;
  }

  if (dataOverrides) {
    defaultData = { ...defaultData, ...dataOverrides } as WorkflowNodeData;
  }

  return {
    id,
    type,
    label,
    description,
    icon,
    iconUrl,
    keywords,
    defaultData,
  };
}

export const nodeCategories: NodeCategory[] = [
  {
    name: 'Core',
    icon: 'Workflow',
    items: [
      node('manual-trigger', 'trigger', 'Manual Trigger', 'Play', 'Start workflow manually'),
      node('schedule-trigger', 'trigger', 'Schedule', 'Clock', 'Run on a cron schedule', {
        keywords: ['cron', 'timer', 'interval'],
        data: { triggerType: 'schedule', config: { cronExpression: '', timezone: '' } },
      }),
      node('webhook-trigger', 'webhook', 'Webhook', 'Webhook', 'Trigger via HTTP webhook', {
        keywords: ['http', 'incoming', 'listener'],
      }),
      node('log', 'action', 'Log', 'Terminal', 'Print a templated message to the console', {
        keywords: ['print', 'console', 'debug'],
        data: { message: '{{ $input }}', level: 'log' },
      }),
      node('http-request', 'action', 'HTTP Request', 'Send', 'Call any REST API', {
        keywords: ['api', 'rest', 'fetch'],
        data: { config: { url: '', method: 'GET', headers: '', body: '', responseType: 'json' } },
      }),
      node('if', 'condition', 'If', 'GitBranch', 'Conditional branching'),
      node('switch', 'condition', 'Switch', 'Shuffle', 'Route to one of many branches', {
        data: { rules: [{ name: 'case-0', condition: '' }], fallbackOutput: 'fallback' },
      }),
      node('loop', 'loop', 'Loop Over Items', 'Repeat', 'Iterate over items', {
        data: { loopMode: 'count' },
      }),
      node('code', 'code', 'Code', 'Code', 'Run JavaScript / Python'),
      node('set', 'action', 'Edit Fields', 'Pencil', 'Set / transform field values', {
        keywords: ['set', 'map', 'assign'],
        data: { config: { fields: [], keepExisting: false } },
      }),
      node('merge', 'action', 'Merge', 'Combine', 'Merge data from multiple branches', {
        data: { config: { mode: 'append' } },
      }),
      node('wait', 'action', 'Wait', 'Hourglass', 'Pause the workflow', {
        data: { config: { duration: 1, unit: 's' } },
      }),
      node('stop-error', 'action', 'Stop and Error', 'OctagonX', 'Halt with an error', {
        keywords: ['throw', 'abort'],
        data: { config: { errorMessage: 'Workflow stopped' } },
      }),
      node('filter', 'condition', 'Filter', 'Filter', 'Drop items that fail a test'),
      node('execute-workflow', 'action', 'Execute Workflow', 'PlayCircle', 'Call another workflow', {
        keywords: ['subflow', 'sub-workflow'],
        data: { config: { workflowId: '', waitForCompletion: true } },
      }),
      node('no-op', 'action', 'No Operation', 'CircleDot', 'Passthrough / placeholder'),
    ],
  },

  {
    name: 'AI',
    icon: 'Sparkles',
    items: [
      node('openai', 'action', 'OpenAI', 'Sparkles', 'GPT, DALL·E, Whisper, embeddings', {
        keywords: ['gpt', 'chatgpt', 'llm', 'dall-e'],
      }),
      node('anthropic', 'action', 'Anthropic Claude', 'Brain', 'Claude chat & completion', {
        keywords: ['claude', 'llm'],
      }),
      node('google-gemini', 'action', 'Google Gemini', 'Gem', 'Gemini models & vision', {
        keywords: ['palm', 'bard', 'llm'],
      }),
      node('ollama', 'action', 'Ollama', 'Bot', 'Run local LLMs', {
        keywords: ['local', 'llama', 'mistral'],
      }),
      node('mistral', 'action', 'Mistral AI', 'Wind', 'Mistral chat models'),
      node('cohere', 'action', 'Cohere', 'MessagesSquare', 'Cohere chat & rerank'),
      node('deepseek', 'action', 'DeepSeek', 'Search', 'DeepSeek chat models'),
      node('xai-grok', 'action', 'xAI Grok', 'Zap', 'Grok chat models'),
      node('huggingface', 'action', 'Hugging Face', 'Hexagon', 'HF inference API', {
        keywords: ['hf', 'transformers'],
      }),
      node('ai-agent', 'action', 'AI Agent', 'Bot', 'Tool-using LLM agent', {
        keywords: ['langchain', 'agent', 'react'],
      }),
      node('memory-buffer', 'action', 'Chat Memory', 'BrainCircuit', 'Short-term agent memory'),
      node('vector-store', 'action', 'Vector Store', 'Boxes', 'Embeddings search store', {
        keywords: ['pinecone', 'qdrant', 'weaviate', 'rag'],
      }),
      node('output-parser', 'action', 'Output Parser', 'Braces', 'Parse structured LLM output', {
        keywords: ['json', 'zod', 'schema'],
      }),
      node('text-classifier', 'action', 'Text Classifier', 'Tag', 'Classify text into categories'),
      node('sentiment-analysis', 'action', 'Sentiment Analysis', 'Smile', 'Score text sentiment'),
      node('embeddings-openai', 'action', 'OpenAI Embeddings', 'Binary', 'Create text embeddings'),
      node('elevenlabs', 'action', 'ElevenLabs', 'Mic', 'Text-to-speech voice generation', {
        keywords: ['tts', 'voice'],
      }),
      node('whisper', 'action', 'Whisper', 'AudioLines', 'Speech-to-text transcription', {
        keywords: ['stt', 'transcribe'],
      }),
      node('perplexity', 'action', 'Perplexity', 'Compass', 'Answer engine with citations'),
      node('replicate', 'action', 'Replicate', 'FlaskConical', 'Run hosted ML models'),
      node('stability-ai', 'action', 'Stability AI', 'Palette', 'Stable Diffusion images'),
    ],
  },

  {
    name: 'Communication',
    icon: 'MessageSquare',
    items: [
      node('gmail', 'action', 'Gmail', 'Mail', 'Send & read Gmail messages', {
        keywords: ['email', 'google'],
      }),
      node('outlook', 'action', 'Microsoft Outlook', 'Mail', 'Send & read Outlook mail', {
        keywords: ['email', 'microsoft'],
      }),
      node('send-email', 'action', 'Send Email (SMTP)', 'AtSign', 'Send email over SMTP'),
      node('email-trigger', 'trigger', 'Email Trigger (IMAP)', 'Inbox', 'Trigger on new emails'),
      node('slack', 'action', 'Slack', 'Slack', 'Send Slack messages & manage channels'),
      node('discord', 'action', 'Discord', 'MessageCircle', 'Post to Discord via webhooks', {
        keywords: ['bot'],
      }),
      node('telegram', 'action', 'Telegram', 'Send', 'Bot messaging & channels'),
      node('whatsapp', 'action', 'WhatsApp Business', 'MessageCircleMore', 'Send WhatsApp messages'),
      node('microsoft-teams', 'action', 'Microsoft Teams', 'Users', 'Post to Teams channels'),
      node('twilio', 'action', 'Twilio', 'PhoneCall', 'SMS, voice, WhatsApp', {
        keywords: ['sms', 'phone'],
      }),
      node('sendgrid', 'action', 'SendGrid', 'MailPlus', 'Transactional email'),
      node('mailgun', 'action', 'Mailgun', 'MailCheck', 'Transactional email API'),
      node('mattermost', 'action', 'Mattermost', 'MessageSquare', 'Self-hosted team chat'),
      node('rocketchat', 'action', 'Rocket.Chat', 'Rocket', 'Open-source team chat'),
      node('line', 'action', 'LINE', 'MessageSquareText', 'LINE messaging'),
      node('signl4', 'action', 'SIGNL4', 'BellRing', 'Critical alert push'),
      node('pushover', 'action', 'Pushover', 'Bell', 'Push notifications to devices'),
      node('pushbullet', 'action', 'Pushbullet', 'BellPlus', 'Cross-device push'),
      node('zoom', 'action', 'Zoom', 'Video', 'Create & manage Zoom meetings'),
    ],
  },

  {
    name: 'Productivity',
    icon: 'Briefcase',
    items: [
      node('google-sheets', 'action', 'Google Sheets', 'Sheet', 'Read/write spreadsheet rows', {
        keywords: ['excel', 'spreadsheet'],
      }),
      node('google-docs', 'action', 'Google Docs', 'FileText', 'Create & edit Google Docs'),
      node('google-drive', 'action', 'Google Drive', 'HardDrive', 'Upload, move, share files'),
      node('google-calendar', 'action', 'Google Calendar', 'Calendar', 'Events & scheduling'),
      node('google-forms', 'action', 'Google Forms', 'ClipboardList', 'Read form responses'),
      node('google-tasks', 'action', 'Google Tasks', 'ListTodo', 'Manage task lists'),
      node('notion', 'action', 'Notion', 'BookOpen', 'Pages & databases'),
      node('airtable', 'action', 'Airtable', 'Table', 'CRUD on Airtable bases'),
      node('todoist', 'action', 'Todoist', 'ListChecks', 'Tasks & projects'),
      node('trello', 'action', 'Trello', 'Trello', 'Boards, lists, cards'),
      node('asana', 'action', 'Asana', 'CircleCheck', 'Tasks & projects'),
      node('monday', 'action', 'monday.com', 'LayoutGrid', 'Work OS boards'),
      node('clickup', 'action', 'ClickUp', 'SquareKanban', 'Tasks, docs, goals'),
      node('jira', 'action', 'Jira', 'Bug', 'Issues & sprints', {
        keywords: ['atlassian', 'ticket'],
      }),
      node('linear', 'action', 'Linear', 'GitPullRequest', 'Issue tracker'),
      node('confluence', 'action', 'Confluence', 'FileStack', 'Wiki pages'),
      node('microsoft-excel', 'action', 'Microsoft Excel 365', 'Sheet', 'Workbook rows & tables'),
      node('microsoft-onedrive', 'action', 'OneDrive', 'Cloud', 'Files in OneDrive'),
      node('dropbox', 'action', 'Dropbox', 'FolderArchive', 'Store & share files'),
      node('box', 'action', 'Box', 'Package', 'Enterprise file storage'),
      node('calendly', 'action', 'Calendly', 'CalendarCheck', 'Scheduled meetings'),
      node('evernote', 'action', 'Evernote', 'StickyNote', 'Notes & notebooks'),
      node('miro', 'action', 'Miro', 'SquarePen', 'Online whiteboard'),
      node('clockify', 'action', 'Clockify', 'Timer', 'Time tracking'),
      node('toggl', 'action', 'Toggl', 'Watch', 'Time tracking'),
    ],
  },

  {
    name: 'Sales & CRM',
    icon: 'Users',
    items: [
      node('hubspot', 'action', 'HubSpot', 'Magnet', 'CRM, marketing, deals'),
      node('salesforce', 'action', 'Salesforce', 'CloudCog', 'Accounts, leads, opportunities'),
      node('pipedrive', 'action', 'Pipedrive', 'Workflow', 'Sales pipeline CRM'),
      node('zoho-crm', 'action', 'Zoho CRM', 'Building2', 'Zoho Contacts & Deals'),
      node('copper', 'action', 'Copper', 'Users', 'Google-native CRM'),
      node('freshworks-crm', 'action', 'Freshworks CRM', 'UserPlus', 'Freshsales contacts'),
      node('activecampaign', 'action', 'ActiveCampaign', 'Megaphone', 'Marketing automation'),
      node('keap', 'action', 'Keap', 'HandCoins', 'Small-business CRM'),
      node('zendesk', 'action', 'Zendesk', 'LifeBuoy', 'Support tickets'),
      node('intercom', 'action', 'Intercom', 'MessagesSquare', 'Customer messaging'),
      node('freshdesk', 'action', 'Freshdesk', 'Headphones', 'Help desk'),
      node('helpscout', 'action', 'Help Scout', 'Ticket', 'Shared inbox help desk'),
      node('drift', 'action', 'Drift', 'MessageCircleHeart', 'Conversational marketing'),
      node('mautic', 'action', 'Mautic', 'Megaphone', 'Open-source marketing automation'),
    ],
  },

  {
    name: 'Developer Tools',
    icon: 'Wrench',
    items: [
      node('github', 'action', 'GitHub', 'Github', 'Repos, issues, PRs, actions'),
      node('github-trigger', 'trigger', 'GitHub Trigger', 'Github', 'Trigger on GitHub events'),
      node('gitlab', 'action', 'GitLab', 'Gitlab', 'Projects, MRs, pipelines'),
      node('bitbucket-trigger', 'trigger', 'Bitbucket Trigger', 'GitFork', 'Trigger on Bitbucket events'),
      node('git', 'action', 'Git', 'GitCommitHorizontal', 'Git CLI operations'),
      node('jenkins', 'action', 'Jenkins', 'Cog', 'Trigger & track Jenkins jobs'),
      node('circleci', 'action', 'CircleCI', 'CircleDotDashed', 'CI/CD pipelines'),
      node('ssh', 'action', 'SSH', 'Terminal', 'Run commands over SSH'),
      node('ftp', 'action', 'FTP / SFTP', 'FolderUp', 'File transfer'),
      node('execute-command', 'action', 'Execute Command', 'SquareTerminal', 'Run a shell command'),
      node('aws-lambda', 'action', 'AWS Lambda', 'Cloud', 'Invoke serverless functions'),
      node('sentry', 'action', 'Sentry.io', 'AlertTriangle', 'Error & performance tracking'),
      node('pagerduty', 'action', 'PagerDuty', 'Siren', 'Incident alerting'),
      node('datadog', 'action', 'Datadog', 'Activity', 'Metrics & logs'),
      node('grafana', 'action', 'Grafana', 'LineChart', 'Dashboards & alerting'),
      node('splunk', 'action', 'Splunk', 'Binary', 'Log search & SIEM'),
    ],
  },

  {
    name: 'Databases',
    icon: 'Database',
    items: [
      node('postgres', 'action', 'Postgres', 'Database', 'Run SQL on Postgres'),
      node('postgres-trigger', 'trigger', 'Postgres Trigger', 'Database', 'Listen for row changes'),
      node('mysql', 'action', 'MySQL', 'Database', 'Run SQL on MySQL'),
      node('microsoft-sql', 'action', 'Microsoft SQL', 'Database', 'Run queries on MSSQL'),
      node('mongodb', 'action', 'MongoDB', 'Database', 'Documents & aggregations'),
      node('redis', 'action', 'Redis', 'Database', 'Key/value, pub-sub, streams'),
      node('supabase', 'action', 'Supabase', 'DatabaseZap', 'Postgres + auth + storage'),
      node('firebase-rtdb', 'action', 'Firebase RTDB', 'Flame', 'Realtime database'),
      node('firestore', 'action', 'Firestore', 'Flame', 'Cloud Firestore documents'),
      node('elasticsearch', 'action', 'Elasticsearch', 'SearchCheck', 'Index & search'),
      node('snowflake', 'action', 'Snowflake', 'Snowflake', 'Cloud data warehouse'),
      node('bigquery', 'action', 'Google BigQuery', 'ChartBar', 'Serverless data warehouse'),
      node('dynamodb', 'action', 'AWS DynamoDB', 'HardDrive', 'Key-value NoSQL'),
      node('cratedb', 'action', 'CrateDB', 'Database', 'Distributed SQL'),
      node('questdb', 'action', 'QuestDB', 'Database', 'Time-series SQL'),
      node('timescaledb', 'action', 'TimescaleDB', 'Database', 'Time-series Postgres'),
    ],
  },

  {
    name: 'Files & Storage',
    icon: 'FolderOpen',
    items: [
      node('aws-s3', 'action', 'AWS S3', 'Cloud', 'Object storage buckets'),
      node('gcs', 'action', 'Google Cloud Storage', 'CloudUpload', 'GCS buckets'),
      node('azure-storage', 'action', 'Azure Storage', 'CloudCog', 'Blob & table storage'),
      node('read-write-file', 'action', 'Read/Write File', 'FileCog', 'Disk file operations'),
      node('read-pdf', 'action', 'Read PDF', 'FileText', 'Extract PDF text'),
      node('convert-to-file', 'action', 'Convert to File', 'FileOutput', 'Encode data to a file', {
        keywords: ['csv', 'xlsx', 'json'],
      }),
      node('extract-from-file', 'action', 'Extract from File', 'FileInput', 'Parse file contents'),
      node('spreadsheet-file', 'action', 'Spreadsheet File', 'Sheet', 'Read / write CSV, XLSX'),
      node('compression', 'action', 'Compression', 'FileArchive', 'Zip / unzip'),
      node('crypto', 'action', 'Crypto', 'KeyRound', 'Hash, HMAC, encrypt'),
    ],
  },

  {
    name: 'Marketing & Social',
    icon: 'Megaphone',
    items: [
      node('mailchimp', 'action', 'Mailchimp', 'MailCheck', 'Email campaigns & lists'),
      node('brevo', 'action', 'Brevo', 'Mails', 'Sendinblue email & SMS'),
      node('mailerlite', 'action', 'MailerLite', 'Mail', 'Email marketing'),
      node('klaviyo', 'action', 'Klaviyo', 'Mails', 'E-commerce email marketing'),
      node('typeform', 'trigger', 'Typeform Trigger', 'ClipboardList', 'Trigger on form submit'),
      node('google-ads', 'action', 'Google Ads', 'BadgeDollarSign', 'Campaigns & reports'),
      node('facebook-graph', 'action', 'Facebook', 'Facebook', 'Graph API calls'),
      node('linkedin', 'action', 'LinkedIn', 'Linkedin', 'Share posts & company pages'),
      node('twitter-x', 'action', 'X (Twitter)', 'Twitter', 'Post tweets & DMs'),
      node('instagram', 'action', 'Instagram', 'Instagram', 'Publish media & comments'),
      node('reddit', 'action', 'Reddit', 'CircleDot', 'Submit posts & read subreddits'),
      node('youtube', 'action', 'YouTube', 'Youtube', 'Channels & videos'),
      node('tiktok', 'action', 'TikTok', 'Music2', 'Publish & analytics'),
      node('buffer', 'action', 'Buffer', 'CalendarClock', 'Schedule social posts'),
    ],
  },

  {
    name: 'E-commerce',
    icon: 'ShoppingCart',
    items: [
      node('shopify', 'action', 'Shopify', 'ShoppingBag', 'Products, orders, customers'),
      node('shopify-trigger', 'trigger', 'Shopify Trigger', 'ShoppingBag', 'Trigger on store events'),
      node('woocommerce', 'action', 'WooCommerce', 'Store', 'WordPress e-commerce'),
      node('stripe', 'action', 'Stripe', 'CreditCard', 'Payments & subscriptions'),
      node('stripe-trigger', 'trigger', 'Stripe Trigger', 'CreditCard', 'Trigger on Stripe events'),
      node('paypal', 'action', 'PayPal', 'Wallet', 'Payments & payouts'),
      node('square', 'action', 'Square', 'Square', 'POS & payments'),
      node('magento', 'action', 'Magento 2', 'Store', 'Magento commerce'),
      node('bigcommerce', 'action', 'BigCommerce', 'Store', 'BigCommerce products & orders'),
    ],
  },

  {
    name: 'Analytics',
    icon: 'LineChart',
    items: [
      node('google-analytics', 'action', 'Google Analytics', 'BarChart3', 'GA4 reports & events'),
      node('mixpanel', 'action', 'Mixpanel', 'ScatterChart', 'Product analytics'),
      node('segment', 'action', 'Segment', 'Split', 'Customer data platform'),
      node('amplitude', 'action', 'Amplitude', 'TrendingUp', 'Product analytics'),
      node('posthog', 'action', 'PostHog', 'Rocket', 'Open-source product analytics'),
      node('plausible', 'action', 'Plausible', 'ChartNoAxesColumn', 'Privacy-first analytics'),
      node('metabase', 'action', 'Metabase', 'ChartPie', 'BI & dashboards'),
    ],
  },

  {
    name: 'Data Transformation',
    icon: 'Shuffle',
    items: [
      node('edit-fields', 'action', 'Edit Fields (Set)', 'Pencil', 'Set field values'),
      node('split-out', 'action', 'Split Out', 'SplitSquareHorizontal', 'Split array into items'),
      node('aggregate', 'action', 'Aggregate', 'Combine', 'Collect items into one'),
      node('summarize', 'action', 'Summarize', 'Sigma', 'Sum, avg, min, max, count'),
      node('remove-duplicates', 'action', 'Remove Duplicates', 'CopyMinus', 'Drop duplicate items'),
      node('sort', 'action', 'Sort', 'ArrowDownUp', 'Order items by field'),
      node('limit', 'action', 'Limit', 'Minimize2', 'Keep first N items'),
      node('compare-datasets', 'action', 'Compare Datasets', 'GitCompare', 'Diff two item lists'),
      node('rename-keys', 'action', 'Rename Keys', 'TextCursorInput', 'Rename object fields'),
      node('html', 'action', 'HTML', 'Code2', 'Build or extract HTML'),
      node('html-extract', 'action', 'HTML Extract', 'CodeXml', 'Parse HTML with CSS selectors'),
      node('markdown', 'action', 'Markdown', 'FileText', 'Convert to/from Markdown'),
      node('xml', 'action', 'XML', 'FileCode', 'Parse & build XML'),
      node('date-time', 'action', 'Date & Time', 'Clock4', 'Format, parse, offset dates'),
      node('item-lists', 'action', 'Item Lists', 'List', 'Array helpers'),
      node('jwt', 'action', 'JWT', 'KeyRound', 'Sign / verify JSON Web Tokens'),
    ],
  },

  {
    name: 'Cybersecurity',
    icon: 'Shield',
    items: [
      node('virustotal', 'action', 'VirusTotal', 'ShieldAlert', 'Scan files & URLs'),
      node('urlscan', 'action', 'urlscan.io', 'ScanSearch', 'Analyze URLs'),
      node('abuseipdb', 'action', 'AbuseIPDB', 'ShieldBan', 'Report / check abusive IPs'),
      node('crowdstrike', 'action', 'CrowdStrike', 'Shield', 'Endpoint security'),
      node('okta', 'action', 'Okta', 'Fingerprint', 'Identity & users'),
      node('bitwarden', 'action', 'Bitwarden', 'LockKeyhole', 'Password vault'),
      node('misp', 'action', 'MISP', 'ShieldCheck', 'Threat intelligence sharing'),
      node('thehive', 'action', 'TheHive', 'Hexagon', 'Incident response'),
    ],
  },
];

/** Flat list for search. */
export const allNodeTemplates: NodeTemplate[] = nodeCategories.flatMap((c) => c.items);
