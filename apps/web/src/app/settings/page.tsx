"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Eye, EyeOff, Key, AlertCircle, CheckCircle, TrendingUp, Hash, DollarSign } from "lucide-react"
import { AppHeader } from "@/components/layout/app-header"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { supabase } from "@/lib/supabase"
import { log } from "@/lib/logger"

export default function SettingsPage() {
  const router = useRouter()
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [openaiModel, setOpenaiModel] = useState("gpt-4")
  const [hasApiKey, setHasApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [usageData, setUsageData] = useState<{
    total_tokens: number
    total_cost: number
    request_count: number
  } | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  useEffect(() => {
    fetchUserSettings()
  }, [])

  const fetchUserSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()

      if (!user || !session?.access_token) {
        router.push("/login")
        return
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/settings`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setHasApiKey(data.has_api_key)
        setOpenaiModel(data.openai_model)

        // Fetch usage data if API key is configured
        if (data.has_api_key) {
          fetchUsageData(session.access_token)
        }
      }
    } catch (err) {
      log.error('Failed to fetch settings', err as Error, { component: 'Settings' })
    } finally {
      setLoadingSettings(false)
    }
  }

  const fetchUsageData = async (accessToken: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/usage`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setUsageData(data)
      }
    } catch (err) {
      log.error('Failed to fetch usage data', err as Error, { component: 'Settings' })
    }
  }

  const handleSaveApiKey = async () => {
    if (!apiKey) {
      setError("Please enter an API key")
      return
    }

    setLoading(true)
    setError("")
    setSuccess("")

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()

      if (!user || !session?.access_token) {
        router.push("/login")
        return
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/settings`, {
        method: hasApiKey ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          openai_api_key: apiKey,
          openai_model: openaiModel,
        }),
      })

      if (response.ok) {
        setSuccess("API key saved successfully! AI features are now enabled.")
        setHasApiKey(true)
        setApiKey("") // Clear the input for security
      } else {
        const data = await response.json()
        setError(data.detail || "Failed to save API key")
      }
    } catch {
      setError("An error occurred while saving the API key")
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteApiKey = async () => {
    setIsDeleteModalOpen(true)
  }

  const confirmDeleteApiKey = async () => {
    setIsDeleteModalOpen(false)

    setLoading(true)
    setError("")
    setSuccess("")

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()

      if (!user || !session?.access_token) {
        router.push("/login")
        return
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/settings/openai-key`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (response.ok) {
        setSuccess("API key deleted successfully")
        setHasApiKey(false)
      } else {
        const data = await response.json()
        setError(data.detail || "Failed to delete API key")
      }
    } catch {
      setError("An error occurred while deleting the API key")
    } finally {
      setLoading(false)
    }
  }

  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
          <p>Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="settings" />

      <div className="container mx-auto py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">設定</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            OpenAI API Configuration
          </CardTitle>
          <CardDescription>
            Configure your personal OpenAI API key to enable AI-powered features
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="model">AI Model</Label>
            <Select value={openaiModel} onValueChange={setOpenaiModel}>
              <SelectTrigger id="model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4">GPT-4 (Recommended)</SelectItem>
                <SelectItem value="gpt-4-turbo-preview">GPT-4 Turbo</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Choose the AI model for generating plans and insights
            </p>
          </div>

          {hasApiKey ? (
            <div className="space-y-4">
              <Alert>
                <Key className="h-4 w-4" />
                <AlertDescription>
                  API key is configured. AI features are enabled.
                </AlertDescription>
              </Alert>
              <Button
                onClick={handleDeleteApiKey}
                variant="destructive"
                disabled={loading}
              >
                Delete API Key
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="apikey">OpenAI API Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="apikey"
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <Button
                  onClick={handleSaveApiKey}
                  disabled={loading || !apiKey}
                >
                  {loading ? "Saving..." : "Save"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  OpenAI Platform
                </a>
              </p>
            </div>
          )}

          <div className="pt-4 border-t">
            <h3 className="font-semibold mb-2">How it works</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Your API key is encrypted and stored securely</li>
              <li>• You pay OpenAI directly for your usage</li>
              <li>• AI features include weekly planning, workload analysis, and task prioritization</li>
              <li>• You can delete your key anytime to disable AI features</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {hasApiKey && usageData && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              API Usage Dashboard
            </CardTitle>
            <CardDescription>
              Your OpenAI API usage for the current period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-blue-600" />
                    <div>
                      <div className="text-2xl font-bold">
                        {usageData.total_tokens.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Tokens</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <div>
                      <div className="text-2xl font-bold">
                        ${usageData.total_cost.toFixed(4)}
                      </div>
                      <div className="text-xs text-muted-foreground">Estimated Cost</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-purple-600" />
                    <div>
                      <div className="text-2xl font-bold">
                        {usageData.request_count}
                      </div>
                      <div className="text-xs text-muted-foreground">API Requests</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              <p>Usage data is updated after each AI operation. Costs are estimated based on current OpenAI pricing.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDeleteApiKey}
        title="API キーを削除"
        description="API キーを削除してもよろしいですか？AI機能が無効になります。"
        confirmText="削除"
        cancelText="キャンセル"
        variant="destructive"
        loading={loading}
      />
      </div>
    </div>
  )
}
