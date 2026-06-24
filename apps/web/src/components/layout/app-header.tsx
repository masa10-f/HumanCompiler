"use client"

// React hooks
import { useState } from 'react'

// Next.js imports
import { useRouter } from 'next/navigation'
import Image from 'next/image'

// UI components
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Icons
import { TrendingUp, Menu, Home, FolderOpen, Calendar, Clock, History, Settings, Play, Timer, ListChecks, MoreHorizontal, ChevronDown, CalendarDays, SlidersHorizontal, LayoutTemplate } from 'lucide-react'

// Hooks
import { useAuth } from '@/hooks/use-auth'

// Utils
import { logger } from '@/lib/logger'

interface AppHeaderProps {
  currentPage?: 'dashboard' | 'projects' | 'ai-planning' | 'triage' | 'scheduling' | 'scheduling-daily' | 'scheduling-settings' | 'scheduler-tuning' | 'schedule-history' | 'work-session-history' | 'timeline' | 'settings' | 'runner'
}

const NAVIGATION_ITEMS = [
  { id: 'dashboard', label: 'ダッシュボード', path: '/dashboard', icon: Home },
  { id: 'runner', label: 'Runner', path: '/runner', icon: Play },
  { id: 'projects', label: 'プロジェクト', path: '/projects', icon: FolderOpen },
  { id: 'scheduling', label: 'スケジューリング', path: '/scheduling', icon: Calendar },
  { id: 'triage', label: 'トリアージ', path: '/triage', icon: ListChecks },
  { id: 'work-session-history', label: 'セッション履歴', path: '/work-session-history', icon: Timer },
  { id: 'timeline', label: 'タイムライン', path: '/timeline', icon: TrendingUp },
  { id: 'settings', label: '設定', path: '/settings', icon: Settings },
] as const

const SCHEDULING_NAVIGATION_ITEMS = [
  { id: 'scheduling', label: '概要', path: '/scheduling', icon: Calendar },
  { id: 'scheduling-daily', label: '日次計画', path: '/scheduling/daily', icon: Clock },
  { id: 'ai-planning', label: '週次計画', path: '/scheduling/weekly', icon: CalendarDays },
  { id: 'scheduler-tuning', label: 'Scheduler調整', path: '/scheduling/tuning', icon: SlidersHorizontal },
  { id: 'scheduling-settings', label: 'テンプレート', path: '/scheduling/settings', icon: LayoutTemplate },
  { id: 'schedule-history', label: 'スケジュール履歴', path: '/scheduling/history', icon: History },
] as const

const PRIMARY_NAVIGATION_IDS = new Set([
  'dashboard',
  'runner',
  'projects',
  'scheduling',
  'triage',
])

const PRIMARY_NAVIGATION_ITEMS = NAVIGATION_ITEMS.filter((item) =>
  PRIMARY_NAVIGATION_IDS.has(item.id)
)

const SECONDARY_NAVIGATION_ITEMS = NAVIGATION_ITEMS.filter(
  (item) => !PRIMARY_NAVIGATION_IDS.has(item.id) && item.id !== 'settings'
)

const SCHEDULING_NAVIGATION_IDS = new Set(
  SCHEDULING_NAVIGATION_ITEMS.map((item) => item.id)
)

export function AppHeader({ currentPage }: AppHeaderProps) {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const getPageClass = (page: string) => {
    return currentPage === page
      ? "bg-primary/10 text-primary font-medium border-b-2 border-primary rounded-none"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
  }

  const isSchedulingActive = Boolean(
    currentPage && SCHEDULING_NAVIGATION_IDS.has(currentPage as typeof SCHEDULING_NAVIGATION_ITEMS[number]['id'])
  )

  const handleNavigation = (path: string) => {
    try {
      router.push(path)
      setIsDialogOpen(false)
    } catch (error) {
      logger.error('Navigation failed', error instanceof Error ? error : new Error(String(error)), { component: 'AppHeader' })
      // ユーザーに通知する場合はtoastなどを使用
    }
  }

  return (
    <header className="bg-card/95 backdrop-blur-sm shadow-md border-b border-border/60 sticky top-0 z-50">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-2 xl:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden xl:gap-4">
            <div className="flex shrink-0 items-center space-x-3">
              <Image
                src="/logo.png"
                alt="HumanCompiler Logo"
                width={32}
                height={32}
                className="rounded-lg shadow-sm"
              />
              <h1 className="hidden text-xl font-bold text-foreground bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent sm:block">
                HumanCompiler
              </h1>
            </div>
            {/* Desktop Navigation */}
            <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex">
              {PRIMARY_NAVIGATION_ITEMS.map((item) => {
                if (item.id === 'scheduling') {
                  return (
                    <DropdownMenu key={item.id}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className={`${isSchedulingActive ? "bg-primary/10 text-primary font-medium border-b-2 border-primary rounded-none" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"} shrink-0 whitespace-nowrap px-2 xl:px-3`}
                          title={item.label}
                        >
                          <item.icon className="h-4 w-4 xl:mr-2" />
                          <span className="hidden xl:inline">{item.label}</span>
                          <ChevronDown className="ml-1 hidden h-3 w-3 xl:inline" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        {SCHEDULING_NAVIGATION_ITEMS.map((child) => (
                          <DropdownMenuItem
                            key={child.id}
                            className={currentPage === child.id ? "bg-primary/10 text-primary font-medium" : ""}
                            onClick={() => router.push(child.path)}
                          >
                            <child.icon className="mr-2 h-4 w-4" />
                            {child.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }

                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => router.push(item.path)}
                    className={`${getPageClass(item.id)} shrink-0 whitespace-nowrap px-2 xl:px-3`}
                    title={item.label}
                  >
                    <item.icon className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">{item.label}</span>
                  </Button>
                )
              })}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={`${SECONDARY_NAVIGATION_ITEMS.some((item) => item.id === currentPage) || currentPage === 'settings' ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"} shrink-0 whitespace-nowrap px-2 xl:px-3`}
                    title="その他"
                  >
                    <MoreHorizontal className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">その他</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {SECONDARY_NAVIGATION_ITEMS.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      className={currentPage === item.id ? "bg-primary/10 text-primary font-medium" : ""}
                      onClick={() => router.push(item.path)}
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={currentPage === 'settings' ? "bg-primary/10 text-primary font-medium" : ""}
                    onClick={() => router.push('/settings')}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    設定
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>

            {/* Mobile Navigation */}
            <div className="lg:hidden">
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="メニューを開く">
                    <Menu className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="flex items-center space-x-3">
                      <Image
                        src="/logo.png"
                        alt="HumanCompiler Logo"
                        width={24}
                        height={24}
                        className="rounded-lg"
                      />
                      <span>HumanCompiler</span>
                    </DialogTitle>
                  </DialogHeader>
                  <div className="mt-6 space-y-2">
                    {NAVIGATION_ITEMS.map((item) => {
                      if (item.id === 'scheduling') {
                        return (
                          <div key={item.id} className="space-y-1">
                            <Button
                              variant={isSchedulingActive ? "secondary" : "ghost"}
                              className="w-full justify-start"
                              onClick={() => handleNavigation(item.path)}
                            >
                              <item.icon className="h-4 w-4 mr-3" />
                              {item.label}
                            </Button>
                            <div className="ml-4 space-y-1 border-l border-border pl-3">
                              {SCHEDULING_NAVIGATION_ITEMS.map((child) => (
                                <Button
                                  key={child.id}
                                  variant={currentPage === child.id ? "secondary" : "ghost"}
                                  className="w-full justify-start text-sm"
                                  onClick={() => handleNavigation(child.path)}
                                >
                                  <child.icon className="h-4 w-4 mr-3" />
                                  {child.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )
                      }

                      return (
                        <Button
                          key={item.id}
                          variant={currentPage === item.id ? "secondary" : "ghost"}
                          className="w-full justify-start"
                          onClick={() => handleNavigation(item.path)}
                        >
                          <item.icon className="h-4 w-4 mr-3" />
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                  <div className="mt-6 border-t border-border/60 pt-4">
                    {user?.email && (
                      <p className="text-sm text-muted-foreground mb-3 truncate px-3 py-1.5 bg-muted/50 rounded-lg">
                        {user.email}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      className="w-full hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50"
                      onClick={signOut}
                    >
                      ログアウト
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="hidden shrink-0 lg:flex items-center gap-2 xl:gap-3">
            {user?.email && (
              <span className="hidden max-w-[220px] truncate rounded-full bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground 2xl:inline-block">
                {user.email}
              </span>
            )}
            <Button variant="outline" onClick={signOut} className="border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 whitespace-nowrap">
              ログアウト
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
