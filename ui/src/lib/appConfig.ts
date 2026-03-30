import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded'

export const API_BASE = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000'
export const SAMPLE_BUNDLE_URL = ((import.meta as any).env?.BASE_URL as string | undefined ?? '/').replace(/\/?$/, '/') + 'traces.sample.json'
export const SESSION_PAGE_SIZE = 8
export const TRACE_PAGE_SIZE = 25
export const EVAL_PAGE_SIZE = 50

export type AppPage = 'parser' | 'evaluation' | 'dashboard'

export const PAGE_META: Array<{ key: AppPage; label: string; description: string; icon: typeof TimelineRoundedIcon; path: string }> = [
  {
    key: 'parser',
    path: '/parser',
    label: 'Parser overview',
    description: 'Session picker, trace filters, pagination, and inspection of the live Copilot event stream.',
    icon: TimelineRoundedIcon,
  },
  {
    key: 'evaluation',
    path: '/evaluation',
    label: 'Evaluation',
    description: 'Quality history, rubric detail, and recent assistant-turn scoring for the active session.',
    icon: AutoGraphRoundedIcon,
  },
  {
    key: 'dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    description: 'Operational readout for coverage, session health, and evaluation signals pulled from the API.',
    icon: DashboardRoundedIcon,
  },
]

export const pageForPath = (hashOrPath: string): AppPage => {
  const normalized = hashOrPath.startsWith('#') ? hashOrPath.slice(1) || '/parser' : hashOrPath
  return PAGE_META.find((item) => item.path === normalized)?.key ?? 'parser'
}

export const pagePath = (page: AppPage) => PAGE_META.find((item) => item.key === page)?.path ?? '/parser'
export const hasWindow = () => typeof window !== 'undefined'
export const getCurrentPath = () => hasWindow() ? (window.location.hash || window.location.pathname) : '/parser'
export const getCurrentSearch = () => hasWindow() ? window.location.search : ''
