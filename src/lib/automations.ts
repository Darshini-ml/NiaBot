// ---------------------------------------------------------------------------
// Automations feature - types, seed data, and utility functions
// ---------------------------------------------------------------------------

// ---- Status / enum types ---------------------------------------------------

export type AutomationStatus = 'active' | 'paused' | 'failed';

export type TriggerType =
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'cron';

export type NotificationSetting =
  | 'email_app'
  | 'app_only'
  | 'email_only'
  | 'none';

// ---- Core domain types -----------------------------------------------------

export interface AutomationTrigger {
  id: string;
  automationId: string;
  type: TriggerType;
  /** HH:mm */
  time: string;
  /** 0 = Sun ... 6 = Sat. null when not applicable. */
  weekdays: number[] | null;
  dayOfMonth: number | null;
  cron: string | null;
  createdAt: string;
}

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface AutomationRun {
  id: string;
  automationId: string;
  userId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: 'running' | 'success' | 'failed';
  output: string | null;
  error: string | null;
  tokens: number | null;
  triggeredBy: 'schedule' | 'manual';
  /** Email delivery fields */
  email_to: string | null;
  email_status: EmailStatus | null;
  email_provider_id: string | null;
  email_error: string | null;
  email_sent_at: string | null;
}

export interface Automation {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  instructions: string;
  model: string;
  skills: string[];
  connectors: string[];
  attachments: any[];
  notification: NotificationSetting;
  notify_email: string;
  timezone: string;
  status: AutomationStatus;
  triggers: AutomationTrigger[];
  lastRunAt: string | null;
  lastRunResult: 'success' | 'failed' | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
  description: string;
  defaultSchedule: {
    type: TriggerType;
    time: string;
    weekdays?: number[];
  };
  instructions: string;
  skills: string[];
}

// ---- Constants -------------------------------------------------------------

export const TEMPLATE_CATEGORIES = [
  'All',
  'News',
  'Productivity',
  'Finance',
  'Research',
  'Personal',
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  News: '#3b82f6',
  Productivity: '#ec4899',
  Finance: '#f97316',
  Research: '#8b5cf6',
  Personal: '#22c55e',
};

export const AUTOMATION_ICONS = [
  'Newspaper',
  'Brain',
  'TrendingUp',
  'DollarSign',
  'Mail',
  'Calendar',
  'Search',
  'BookOpen',
  'BarChart3',
  'Bell',
  'Zap',
  'Target',
  'Globe',
  'FileText',
  'Lightbulb',
  'Heart',
] as const;

export const AUTOMATION_COLORS = [
  '#3b82f6',
  '#ec4899',
  '#f97316',
  '#8b5cf6',
  '#22c55e',
  '#ef4444',
] as const;

// ---- Seed templates --------------------------------------------------------

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // -- News ------------------------------------------------------------------
  {
    id: 'tpl_morning_brief',
    name: 'Morning Brief',
    category: 'News',
    icon: 'Newspaper',
    color: CATEGORY_COLORS.News,
    description:
      'Get a concise summary of the top headlines every morning before you start your day.',
    defaultSchedule: { type: 'daily', time: '07:00' },
    instructions:
      'Scan the top news sources and compile a concise morning briefing. Include the 5-8 most important headlines across world news, business, and technology. For each item provide a one-sentence summary and a relevance note. Keep the total length under 500 words.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_ai_news_digest',
    name: 'AI News Digest',
    category: 'News',
    icon: 'Brain',
    color: CATEGORY_COLORS.News,
    description:
      'Stay up to date with the latest breakthroughs and announcements in AI and machine learning.',
    defaultSchedule: { type: 'daily', time: '08:00' },
    instructions:
      'Search for the latest AI and machine-learning news from the past 24 hours. Cover new model releases, research papers, industry announcements, and regulatory developments. Summarize each item in 2-3 sentences and group them by theme.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_x_trends',
    name: 'X Trends Digest',
    category: 'News',
    icon: 'TrendingUp',
    color: CATEGORY_COLORS.News,
    description:
      'A daily roundup of the most talked-about topics and trending conversations on X.',
    defaultSchedule: { type: 'daily', time: '12:00' },
    instructions:
      'Identify the top trending topics on X (formerly Twitter) right now. For each trend, explain what it is about and why it is trending. Highlight any notable tweets or threads. Present the results as a numbered list of 5-10 trends.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_competitor_watch',
    name: 'Competitor Watch',
    category: 'News',
    icon: 'Search',
    color: CATEGORY_COLORS.News,
    description:
      'Monitor competitor activity including product launches, press releases, and social media mentions.',
    defaultSchedule: { type: 'weekdays', time: '09:00' },
    instructions:
      'Search for recent news, blog posts, and social-media mentions about [COMPETITOR NAMES]. Summarize any product updates, hiring announcements, partnerships, or notable public statements. Flag anything that could impact our positioning.',
    skills: ['web_search'],
  },

  // -- Productivity ----------------------------------------------------------
  {
    id: 'tpl_email_auto_responder',
    name: 'Email Auto-Responder',
    category: 'Productivity',
    icon: 'Mail',
    color: CATEGORY_COLORS.Productivity,
    description:
      'Automatically draft polite replies to common emails so you can review and send them quickly.',
    defaultSchedule: { type: 'hourly', time: '00:00' },
    instructions:
      'Check for new unread emails. For each email, draft a polite and professional reply. If the email requires action, note the action item separately. Keep replies concise -- aim for 3-5 sentences unless the context demands more detail.',
    skills: ['email'],
  },
  {
    id: 'tpl_weekly_review',
    name: 'Weekly Review',
    category: 'Productivity',
    icon: 'Calendar',
    color: CATEGORY_COLORS.Productivity,
    description:
      'Generate a weekly summary of accomplishments, pending tasks, and goals for the coming week.',
    defaultSchedule: { type: 'weekly', time: '17:00', weekdays: [5] },
    instructions:
      'Review my completed tasks, calendar events, and notes from the past week. Produce a structured weekly review with three sections: Accomplishments (what got done), Carry-Over (what is still pending), and Next Week (suggested priorities). Keep it actionable.',
    skills: ['calendar', 'tasks'],
  },
  {
    id: 'tpl_task_extractor',
    name: 'Task Extractor',
    category: 'Productivity',
    icon: 'FileText',
    color: CATEGORY_COLORS.Productivity,
    description:
      'Parse meeting notes and documents to automatically extract action items and deadlines.',
    defaultSchedule: { type: 'daily', time: '18:00' },
    instructions:
      'Scan recent meeting notes and documents for action items. Extract each task, assign an owner if mentioned, note any deadlines, and output a clean checklist. Group tasks by project or meeting when possible.',
    skills: ['documents'],
  },
  {
    id: 'tpl_daily_planner',
    name: 'Daily Planner',
    category: 'Productivity',
    icon: 'Target',
    color: CATEGORY_COLORS.Productivity,
    description:
      'Create a prioritized daily plan based on your calendar, tasks, and goals.',
    defaultSchedule: { type: 'weekdays', time: '06:30' },
    instructions:
      'Look at my calendar events and pending tasks for today. Create a time-blocked daily plan that prioritizes high-impact work in the morning. Include breaks and buffer time between meetings. Flag any scheduling conflicts.',
    skills: ['calendar', 'tasks'],
  },

  // -- Finance ---------------------------------------------------------------
  {
    id: 'tpl_daily_stock_tracker',
    name: 'Daily Stock Tracker',
    category: 'Finance',
    icon: 'BarChart3',
    color: CATEGORY_COLORS.Finance,
    description:
      'Track your watchlist stocks with daily price changes, volume, and key metrics.',
    defaultSchedule: { type: 'weekdays', time: '16:30' },
    instructions:
      'Retrieve end-of-day prices for [WATCHLIST TICKERS]. For each ticker report: closing price, daily change (% and absolute), volume vs. average, and 52-week high/low comparison. Highlight any stock that moved more than 3% today.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_earnings_calendar',
    name: 'Earnings Calendar',
    category: 'Finance',
    icon: 'Calendar',
    color: CATEGORY_COLORS.Finance,
    description:
      'Get a weekly preview of upcoming earnings reports for companies you follow.',
    defaultSchedule: { type: 'weekly', time: '08:00', weekdays: [1] },
    instructions:
      'List all earnings reports scheduled for the coming week for companies in my watchlist and any S&P 500 companies with broad market impact. Include expected report date, consensus EPS estimate, and revenue estimate. Note any pre/post-market timing.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_portfolio_news_scan',
    name: 'Portfolio News Scan',
    category: 'Finance',
    icon: 'Globe',
    color: CATEGORY_COLORS.Finance,
    description:
      'Scan for breaking news, SEC filings, and analyst reports related to your portfolio holdings.',
    defaultSchedule: { type: 'daily', time: '07:30' },
    instructions:
      'Search for the latest news, SEC filings, analyst upgrades/downgrades, and insider transactions for [PORTFOLIO TICKERS]. Flag anything material -- earnings surprises, guidance changes, major contracts, or regulatory actions. Summarize each finding in 1-2 sentences.',
    skills: ['web_search'],
  },

  // -- Research --------------------------------------------------------------
  {
    id: 'tpl_paper_watch',
    name: 'Paper Watch',
    category: 'Research',
    icon: 'BookOpen',
    color: CATEGORY_COLORS.Research,
    description:
      'Monitor arXiv and other sources for new papers matching your research interests.',
    defaultSchedule: { type: 'daily', time: '09:00' },
    instructions:
      'Search arXiv and Google Scholar for papers published in the last 24 hours matching [RESEARCH KEYWORDS]. For each relevant paper provide: title, authors, a 2-sentence summary of the contribution, and a direct link. Limit to the top 5 most relevant results.',
    skills: ['web_search'],
  },
  {
    id: 'tpl_topic_deep_dive',
    name: 'Topic Deep-Dive',
    category: 'Research',
    icon: 'Lightbulb',
    color: CATEGORY_COLORS.Research,
    description:
      'Generate an in-depth research brief on a specified topic, synthesizing multiple sources.',
    defaultSchedule: { type: 'weekly', time: '10:00', weekdays: [3] },
    instructions:
      'Conduct a deep-dive research session on [TOPIC]. Gather information from at least 5 credible sources. Produce a structured brief with: Executive Summary, Key Findings (with citations), Open Questions, and Suggested Next Steps. Aim for 800-1200 words.',
    skills: ['web_search'],
  },

  // -- Personal --------------------------------------------------------------
  {
    id: 'tpl_habit_checkin',
    name: 'Habit Check-in',
    category: 'Personal',
    icon: 'Heart',
    color: CATEGORY_COLORS.Personal,
    description:
      'A friendly daily check-in that helps you track habits and reflect on your day.',
    defaultSchedule: { type: 'daily', time: '21:00' },
    instructions:
      "Send a friendly evening check-in asking about today's habits: exercise, water intake, reading, and sleep quality. Provide a short motivational note based on recent streaks. If a habit was missed, suggest a small action for tomorrow rather than criticism.",
    skills: [],
  },
  {
    id: 'tpl_learning_nudge',
    name: 'Learning Nudge',
    category: 'Personal',
    icon: 'Zap',
    color: CATEGORY_COLORS.Personal,
    description:
      'Receive a daily micro-lesson or interesting fact on a topic you are trying to learn.',
    defaultSchedule: { type: 'daily', time: '12:30' },
    instructions:
      'Pick one concept related to [LEARNING TOPIC] and explain it in a short, engaging micro-lesson (150-250 words). Include a real-world analogy, one surprising fact, and a quick quiz question at the end to reinforce retention.',
    skills: [],
  },
];

// ---- Utility functions -----------------------------------------------------

/**
 * Parse an "HH:mm" string into hours and minutes.
 */
function parseTime(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Build a Date representing "now" in a specific IANA timezone.
 * Falls back to the local environment timezone if the given zone is invalid.
 */
function nowInTimezone(timezone: string): Date {
  try {
    const nowUtc = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(nowUtc);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);

    return new Date(
      Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour'),
        get('minute'),
        get('second'),
      ),
    );
  } catch {
    return new Date();
  }
}

/**
 * Compute the next run time for a set of triggers, returning the earliest
 * upcoming occurrence as an ISO 8601 string, or null if it cannot be
 * determined.
 */
export function computeNextRunAt(
  triggers: AutomationTrigger[],
  timezone: string,
  after?: Date,
): string | null {
  if (triggers.length === 0) return null;

  const now = after ?? nowInTimezone(timezone);
  let earliest: Date | null = null;

  for (const trigger of triggers) {
    const candidate = computeNextForTrigger(trigger, now);
    if (candidate && (!earliest || candidate < earliest)) {
      earliest = candidate;
    }
  }

  return earliest ? earliest.toISOString() : null;
}

function computeNextForTrigger(
  trigger: AutomationTrigger,
  now: Date,
): Date | null {
  const { hours, minutes } = parseTime(trigger.time);

  switch (trigger.type) {
    case 'hourly': {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }

    case 'daily': {
      const today = new Date(now);
      today.setHours(hours, minutes, 0, 0);
      if (today > now) return today;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }

    case 'weekdays': {
      // Mon = 1 ... Fri = 5
      for (let offset = 0; offset <= 7; offset++) {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        d.setHours(hours, minutes, 0, 0);
        const dow = d.getDay(); // 0 = Sun
        if (dow >= 1 && dow <= 5 && d > now) return d;
      }
      return null;
    }

    case 'weekly': {
      const targetDays = trigger.weekdays ?? [1]; // default Monday
      for (let offset = 0; offset <= 7; offset++) {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        d.setHours(hours, minutes, 0, 0);
        if (targetDays.includes(d.getDay()) && d > now) return d;
      }
      return null;
    }

    case 'monthly': {
      const dom = trigger.dayOfMonth ?? 1;
      const thisMonth = new Date(now);
      thisMonth.setDate(dom);
      thisMonth.setHours(hours, minutes, 0, 0);
      if (thisMonth > now) return thisMonth;
      const nextMonth = new Date(thisMonth);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      return nextMonth;
    }

    case 'cron': {
      // Cron evaluation requires a dedicated library; return null.
      return null;
    }

    default:
      return null;
  }
}

/**
 * Format a date string as relative time from now.
 * Examples: "in 20 hr.", "3 min. ago", "in 2 days"
 */
export function formatRelativeTime(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const absDiff = Math.abs(diffMs);
  const isFuture = diffMs > 0;

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label: string;

  if (days > 0) {
    label = `${days} day${days === 1 ? '' : 's'}`;
  } else if (hours > 0) {
    label = `${hours} hr.`;
  } else if (minutes > 0) {
    label = `${minutes} min.`;
  } else {
    label = `${seconds} sec.`;
  }

  return isFuture ? `in ${label}` : `${label} ago`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "1m 23s", "2h 5m 10s", "450ms"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}
