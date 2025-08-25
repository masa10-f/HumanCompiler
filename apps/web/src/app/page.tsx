import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, Calendar, Clock, Target } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 dark:text-white mb-6">
            HumanCompiler
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
            AI-powered task management and scheduling system for research and development projects
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-lg px-8 py-3">
              <Link href="/login">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-lg px-8 py-3">
              <Link href="/signup">
                Learn More
              </Link>
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <Card className="text-center">
            <CardHeader>
              <Target className="h-12 w-12 text-blue-600 mx-auto mb-4" />
              <CardTitle>Goal-Driven Planning</CardTitle>
              <CardDescription>
                Organize projects into goals and tasks with AI-powered estimation
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <Calendar className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <CardTitle>Smart Scheduling</CardTitle>
              <CardDescription>
                OR-Tools optimization for efficient time allocation and deadline management
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <Clock className="h-12 w-12 text-purple-600 mx-auto mb-4" />
              <CardTitle>Progress Tracking</CardTitle>
              <CardDescription>
                Real-time progress monitoring with automatic rescheduling
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Architecture Overview */}
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl text-center">How It Works</CardTitle>
              <CardDescription className="text-center">
                Four-layer hierarchy: Projects → Goals → Tasks → Logs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-4 gap-4 text-center">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <h3 className="font-semibold">Projects</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    High-level objectives
                  </p>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <h3 className="font-semibold">Goals</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Weekly milestones
                  </p>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                  <h3 className="font-semibold">Tasks</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Daily activities
                  </p>
                </div>
                <div className="p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                  <h3 className="font-semibold">Logs</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Time tracking
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
