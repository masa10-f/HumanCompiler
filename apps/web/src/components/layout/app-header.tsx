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
import { TrendingUp, Menu, Home, FolderOpen, Calendar, Clock, History, Settings } from 'lucide-react'

// Hooks
import { useAuth } from '@/hooks/use-auth'

// Utils
import { logger } from '@/lib/logger'

interface AppHeaderProps {
  currentPage?: 'dashboard' | 'projects' | 'ai-planning' | 'scheduling' | 'schedule-history' | 'timeline' | 'settings'
}

const NAVIGATION_ITEMS = [
  { id: 'dashboard', label: 'ダッシュボード', path: '/dashboard', icon: Home },
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
      ? "text-gray-900 dark:text-white font-medium"
      : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
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
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-3">
              <Image
                src="/logo.png"
                alt="HumanCompiler Logo"
                width={32}
                height={32}
                className="rounded-lg"
              />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                HumanCompiler
              </h1>
            </div>
            {/* Desktop Navigation */}
            <nav className="hidden md:flex space-x-4">
              {NAVIGATION_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => router.push(item.path)}
                  className={getPageClass(item.id)}
                >
                  <item.icon className="h-4 w-4 mr-2" />
                  {item.label}
                </Button>
              ))}
            </nav>

            {/* Mobile Navigation */}
            <div className="md:hidden">
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
                  <div className="mt-6 border-t pt-4">
                    {user?.email && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 truncate">
                        {user.email}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={signOut}
                    >
                      ログアウト
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            {user?.email && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {user.email}
              </span>
            )}
            <Button variant="outline" onClick={signOut}>
              ログアウト
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
