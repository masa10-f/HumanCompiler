"use client"

// React hooks
import { useState } from 'react'

// Next.js imports
import { useRouter } from 'next/navigation'
import Image from 'next/image'

// UI components
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

// Icons
import { TrendingUp, Menu, Home, FolderOpen, Calendar, Clock, History, Settings, Play } from 'lucide-react'

// Hooks
import { useAuth } from '@/hooks/use-auth'

// Utils
import { logger } from '@/lib/logger'

interface AppHeaderProps {
  currentPage?: 'dashboard' | 'projects' | 'ai-planning' | 'scheduling' | 'schedule-history' | 'timeline' | 'settings' | 'runner'
}

const NAVIGATION_ITEMS = [
  { id: 'dashboard', label: 'ダッシュボード', path: '/dashboard', icon: Home },
  { id: 'runner', label: 'Runner', path: '/runner', icon: Play },
  { id: 'projects', label: 'プロジェクト', path: '/projects', icon: FolderOpen },
  { id: 'ai-planning', label: '週次計画', path: '/ai-planning', icon: Calendar },
  { id: 'scheduling', label: '日次計画', path: '/scheduling', icon: Clock },
  { id: 'schedule-history', label: 'スケジュール履歴', path: '/schedule-history', icon: History },
  { id: 'timeline', label: 'タイムライン', path: '/timeline', icon: TrendingUp },
  { id: 'settings', label: '設定', path: '/settings', icon: Settings },
] as const

export function AppHeader({ currentPage }: AppHeaderProps) {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const getPageClass = (page: string) => {
    return currentPage === page
      ? "bg-primary/10 text-primary font-medium border-b-2 border-primary rounded-none"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
  }

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-3">
              <Image
                src="/logo.png"
                alt="HumanCompiler Logo"
                width={32}
                height={32}
                className="rounded-lg shadow-sm"
              />
              <h1 className="text-xl font-bold text-foreground bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                HumanCompiler
              </h1>
            </div>
            {/* Desktop Navigation */}
            <nav className="hidden lg:flex space-x-1">
              {NAVIGATION_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => router.push(item.path)}
                  className={`${getPageClass(item.id)} px-2 xl:px-3`}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4 xl:mr-2" />
                  <span className="hidden xl:inline">{item.label}</span>
                </Button>
              ))}
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
                    {NAVIGATION_ITEMS.map((item) => (
                      <Button
                        key={item.id}
                        variant={currentPage === item.id ? "secondary" : "ghost"}
                        className="w-full justify-start"
                        onClick={() => handleNavigation(item.path)}
                      >
                        <item.icon className="h-4 w-4 mr-3" />
                        {item.label}
                      </Button>
                    ))}
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
          <div className="hidden lg:flex items-center space-x-2 xl:space-x-4">
            {user?.email && (
              <span className="hidden xl:inline text-sm text-muted-foreground px-3 py-1.5 bg-muted/50 rounded-full truncate max-w-[200px]">
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
