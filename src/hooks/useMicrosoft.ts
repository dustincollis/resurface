import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'

export interface MicrosoftConnection {
  refresh_token: string
  account_email?: string | null
  connected_at?: string
  last_synced_at?: string
}

const SCOPES = 'Calendars.Read offline_access User.Read'

export function getMicrosoftAuthorizeUrl(): string | null {
  const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID
  const redirectUri = import.meta.env.VITE_MICROSOFT_REDIRECT_URI
  if (!clientId || !redirectUri) return null

  const state = crypto.randomUUID()
  sessionStorage.setItem('ms_oauth_state', state)

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_mode: 'query',
    state,
  })

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

export function useExchangeMicrosoftCode() {
  return useMutation({
    mutationFn: async ({ code, redirect_uri }: { code: string; redirect_uri: string }) => {
      const { data, error } = await supabase.functions.invoke('microsoft-oauth-exchange', {
        body: { code, redirect_uri },
      })
      if (error) throw error
      return data as { success: boolean; account_email: string | null }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useSyncMicrosoft() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('microsoft-sync-calendar')
      if (error) throw error
      return data as { synced: number; users_processed: number; errors?: unknown[] }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useDisconnectMicrosoft() {
  return useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: profile } = await supabase
        .from('profiles')
        .select('settings')
        .eq('id', user.id)
        .single()

      const settings = (profile?.settings as Record<string, unknown>) ?? {}
      // Remove microsoft key
      const newSettings = { ...settings }
      delete newSettings.microsoft

      const { error } = await supabase
        .from('profiles')
        .update({ settings: newSettings })
        .eq('id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}
