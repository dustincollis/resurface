import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { useExchangeMicrosoftCode } from '../hooks/useMicrosoft'

export default function MicrosoftCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const exchange = useExchangeMicrosoftCode()
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasRunRef = useRef(false)

  useEffect(() => {
    if (hasRunRef.current) return
    hasRunRef.current = true

    const fail = (msg: string) => {
      queueMicrotask(() => {
        setStatus('error')
        setErrorMessage(msg)
      })
    }

    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    const state = searchParams.get('state')
    const expectedState = sessionStorage.getItem('ms_oauth_state')

    if (error) {
      fail(errorDescription ?? error)
      return
    }

    if (!code) {
      fail('No authorization code received from Microsoft.')
      return
    }

    if (expectedState && state !== expectedState) {
      fail('OAuth state mismatch. Please try connecting again.')
      return
    }
    sessionStorage.removeItem('ms_oauth_state')

    const redirectUri = import.meta.env.VITE_MICROSOFT_REDIRECT_URI
    if (!redirectUri) {
      fail('Microsoft redirect URI not configured.')
      return
    }

    queueMicrotask(() => {
      exchange.mutate(
        { code, redirect_uri: redirectUri },
        {
          onSuccess: () => {
            setStatus('success')
            setTimeout(() => navigate('/settings'), 1500)
          },
          onError: (err) => {
            setStatus('error')
            setErrorMessage(err instanceof Error ? err.message : 'Failed to connect Microsoft account')
          },
        }
      )
    })
  }, [searchParams, exchange, navigate])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center pt-16 text-center">
      {status === 'pending' && (
        <>
          <Loader2 size={32} className="mb-4 animate-spin text-purple-400" />
          <h1 className="text-lg font-semibold text-white">Connecting Microsoft account...</h1>
          <p className="mt-2 text-sm text-gray-400">Exchanging authorization code for access tokens.</p>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircle size={32} className="mb-4 text-green-400" />
          <h1 className="text-lg font-semibold text-white">Connected!</h1>
          <p className="mt-2 text-sm text-gray-400">Redirecting to settings...</p>
        </>
      )}

      {status === 'error' && (
        <>
          <AlertCircle size={32} className="mb-4 text-red-400" />
          <h1 className="text-lg font-semibold text-white">Connection failed</h1>
          <p className="mt-2 text-sm text-gray-400">{errorMessage}</p>
          <button
            onClick={() => navigate('/settings')}
            className="mt-4 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            Back to Settings
          </button>
        </>
      )}
    </div>
  )
}
