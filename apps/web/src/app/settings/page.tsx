"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Eye, EyeOff, Key, AlertCircle, CheckCircle, TrendingUp, Hash, DollarSign, RefreshCw } from "lucide-react"
import { AppHeader } from "@/components/layout/app-header"
import { ConfirmationModal } from "@/components/ui/confirmation-modal"
import { supabase } from "@/lib/supabase"
import { log } from "@/lib/logger"

interface ApiUsageData {
  total_tokens: number
  total_cost: number
  request_count: number
}

interface ModelInfo {
  name: string
  description: string
  max_context: string
  max_output: string
  modalities: string[]
}

interface AvailableModels {
  [key: string]: ModelInfo
}

// OpenAI API key validation regex - supports both old and new formats
const OPENAI_API_KEY_REGEX = /^sk-[a-zA-Z0-9-_]{20,}$/

// Default model from environment or fallback
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_DEFAULT_OPENAI_MODEL || "gpt-5"

export default function SettingsPage() {
  const router = useRouter()
  const abortControllerRef = useRef<AbortController | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_MODEL)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [usageData, setUsageData] = useState<ApiUsageData | null>(null)
  const [usageError, setUsageError] = useState("")
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null)

  useEffect(() => {
    // Create AbortController for cleanup
    abortControllerRef.current = new AbortController()

    fetchUserSettings()
    fetchAvailableModels()

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array is intentional - only run on mount

  // Memoize model options for performance
  const modelOptions = useMemo(() => {
    if (!availableModels) {
      return <SelectItem value={DEFAULT_MODEL}>{DEFAULT_MODEL.toUpperCase()} (Loading...)</SelectItem>
    }
    return Object.entries(availableModels).map(([modelId, modelInfo]) => (
      <SelectItem key={modelId} value={modelId}>
        <div className="flex flex-col">
          <span className="font-medium">{modelInfo.name}</span>
          <span className="text-sm text-muted-foreground">{modelInfo.description}</span>
          <span className="text-xs text-muted-foreground">
            コンテキスト: {modelInfo.max_context} | 出力: {modelInfo.max_output}
          </span>
        </div>
      </SelectItem>
    ))
  }, [availableModels])

  const fetchAvailableModels = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/models`, {
        signal: abortControllerRef.current?.signal
      })

      if (response.ok) {
        const data = await response.json()
        setAvailableModels(data.models)

        // Ensure current model selection is valid
        const modelIds = Object.keys(data.models)
        if (modelIds.length > 0 && !modelIds.includes(openaiModel)) {
          // Set to first available model if current selection is invalid
          const firstModel = modelIds[0]
          if (firstModel) {
            setOpenaiModel(firstModel)
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return // Request was aborted, ignore the error
      }
      log.error('Failed to fetch available models', err as Error, { component: 'Settings' })
    }
  }

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
        signal: abortControllerRef.current?.signal
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
      if (err instanceof Error && err.name === 'AbortError') {
        return // Request was aborted, ignore the error
      }
      log.error('Failed to fetch settings', err as Error, { component: 'Settings' })
    } finally {
      setLoadingSettings(false)
    }
  }

  const fetchUsageData = async (accessToken: string) => {
    try {
      setLoadingUsage(true)
      setUsageError("") // Clear previous errors
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/user/usage`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: abortControllerRef.current?.signal
      })

      if (response.ok) {
        const data = await response.json()
        setUsageData(data)
      } else {
        const errorData = await response.json().catch(() => ({ detail: "Failed to load usage data" }))
        setUsageError(errorData.detail || "Failed to load usage data")
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return // Request was aborted, ignore the error
      }
      setUsageError("Network error occurred while loading usage data")
      log.error('Failed to fetch usage data', err as Error, { component: 'Settings' })
    } finally {
      setLoadingUsage(false)
    }
  }

  const handleSaveApiKey = async () => {
    if (!apiKey) {
      setError("Please enter an API key")
      return
    }

    if (!OPENAI_API_KEY_REGEX.test(apiKey)) {
      setError("Please enter a valid OpenAI API key (format: sk-...)")
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
        // Refresh usage data after saving
        fetchUsageData(session.access_token)
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

  const handleSaveModelOnly = async () => {
    if (!hasApiKey) {
      setError("Please configure an API key first")
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
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          openai_model: openaiModel,
        }),
      })

      if (response.ok) {
        setSuccess("Model updated successfully!")
      } else {
        const data = await response.json()
        setError(data.detail || "Failed to update model")
      }
    } catch {
      setError("An error occurred while updating the model")
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshUsage = async () => {
    if (isRefreshing) return // Prevent multiple concurrent requests

    try {
      setIsRefreshing(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await fetchUsageData(session.access_token)
      }
    } catch (err) {
      log.error('Failed to refresh usage data', err as Error, { component: 'Settings' })
    } finally {
      setIsRefreshing(false)
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
        <div className="flex flex-col items-center">
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
            <div className="flex gap-2">
              <Select value={openaiModel} onValueChange={setOpenaiModel}>
                <SelectTrigger id="model" className="flex-1">
                  <SelectValue>
                    {availableModels && availableModels[openaiModel] ?
                      availableModels[openaiModel].name :
                      openaiModel
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {modelOptions}
                </SelectContent>
              </Select>
              {hasApiKey && (
                <Button
                  onClick={handleSaveModelOnly}
                  disabled={loading}
                  variant="outline"
                >
                  {loading ? "Updating..." : "Update Model"}
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              AI計画生成と洞察に使用するモデルを選択してください
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

      {hasApiKey && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  API Usage Dashboard
                </CardTitle>
                <CardDescription>
                  Your OpenAI API usage for the current period
                </CardDescription>
              </div>
              <Button
                onClick={handleRefreshUsage}
                variant="outline"
                size="sm"
                disabled={loadingUsage || isRefreshing}
              >
                {loadingUsage || isRefreshing ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {usageError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{usageError}</AlertDescription>
              </Alert>
            )}
            {usageData ? (
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
                          ${typeof usageData.total_cost === 'number' ? usageData.total_cost.toFixed(4) : '0.0000'}
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
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No usage data available yet. Start using AI features to see your usage statistics.</p>
              </div>
            )}

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
