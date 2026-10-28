import { useEffect, useRef, useState } from 'react'
import './App.css'
import ActionToast from './ActionToast.jsx'
import AdminAccessDenied, { AdminLayout } from './AdminLayout.jsx'
import Dashboard from './Dashboard.jsx'
import { isAdminUser } from './lib/adminAuth.js'
import { ACCOUNT_APP_PATH, ADMIN_BASE_PATH, getAccountAppRedirectUrl } from './lib/routes.js'
import { supabase, supabaseConfigurationMessage } from './lib/supabase.js'

const MAX_ID_FILE_SIZE = 10 * 1024 * 1024
const SIGN_IN_SLOW_NOTICE_DELAY = 8000
const SIGN_IN_TIMEOUT = 30000
const isAdminPath = window.location.pathname === ADMIN_BASE_PATH || window.location.pathname.startsWith(`${ADMIN_BASE_PATH}/`)

function formatUsPhoneInput(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  digits = digits.slice(0, 10)
  if (digits.length > 6) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length > 3) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return digits
}

function formatUsTaxIdInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 9)
  if (digits.length > 5) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
  if (digits.length > 3) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return digits
}

function formatBirthDateInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return digits
}

function isAllowedIdFile(file) {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf']
  const hasAllowedExtension = /\.(jpe?g|png|pdf)$/i.test(file.name)

  return (
    file.size > 0 &&
    file.size <= MAX_ID_FILE_SIZE &&
    hasAllowedExtension &&
    (!file.type || file.type === 'application/octet-stream' || allowedMimeTypes.includes(file.type))
  )
}

function getFriendlyErrorMessage(error, fallback = 'We could not complete your request. Please try again.') {
  const message = (typeof error === 'string' ? error : error?.message)?.trim()
  if (!message) return fallback

  const normalizedMessage = message.toLowerCase()
  if (/failed to fetch|network(error| request failed)|fetch failed|offline|connection (lost|failed|refused)|load failed/.test(normalizedMessage)) {
    return 'We could not connect. Check your internet connection and try again.'
  }
  if (/timed? ?out|timeout/.test(normalizedMessage)) {
    return 'This is taking longer than expected. Check your internet connection and try again.'
  }
  if (/database error|internal server error|server error|service unavailable|\b5\d\d\b/.test(normalizedMessage)) {
    return 'We could not complete your request right now. Please try again in a few minutes.'
  }
  if (/invalid login credentials|invalid email or password/.test(normalizedMessage)) {
    return 'The email or password you entered is incorrect. Check your details and try again.'
  }
  if (/email not confirmed/.test(normalizedMessage)) {
    return 'Please confirm your email address before signing in.'
  }
  if (/user already registered|already been registered|already exists/.test(normalizedMessage)) {
    return 'An account with these details already exists. Try signing in instead.'
  }
  if (/too many requests|rate limit/.test(normalizedMessage)) {
    return 'There have been too many attempts. Please wait a few minutes and try again.'
  }

  return message
}

async function getFunctionErrorMessage(error) {
  const response = error?.context
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json()
      if (typeof body?.error === 'string') return getFriendlyErrorMessage(body.error)
    } catch {
      return getFriendlyErrorMessage(error, 'We could not submit your application. Please try again.')
    }
  }
  return getFriendlyErrorMessage(error, 'We could not submit your application. Please try again.')
}

async function getPendingTotpFactor() {
  if (!supabase) return null
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError) throw assuranceError
  if (assurance.currentLevel === 'aal2' || assurance.nextLevel !== 'aal2') return null

  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.totp.find((factor) => factor.status === 'verified') || null
}

function dismissActionFeedback() {
  setActionFeedback(null)
}

function App() {
  const [mode, setMode] = useState(
    isAdminPath || window.location.pathname.startsWith(ACCOUNT_APP_PATH) ? 'sign-in' : 'welcome',
  )
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authMessageType, setAuthMessageType] = useState('error')
  const [actionFeedback, setActionFeedback] = useState(null)
  const [signupPassword, setSignupPassword] = useState('')
  const [showSignupPassword, setShowSignupPassword] = useState(false)
  const [phoneType, setPhoneType] = useState('mobile')
  const [setupStep, setSetupStep] = useState(1)
  const [showTaxId, setShowTaxId] = useState(false)
  const [openHint, setOpenHint] = useState('')
  const [mailingAddressDifferent, setMailingAddressDifferent] = useState(false)
  const [applicationData, setApplicationData] = useState({})
  const [governmentIdType, setGovernmentIdType] = useState('drivers-license')
  const [idUploadErrors, setIdUploadErrors] = useState({})
  const [draggingUpload, setDraggingUpload] = useState('')
  const [frontImage, setFrontImage] = useState(null)
  const [backImage, setBackImage] = useState(null)
  const kycSubmissionRef = useRef(null)
  const frontImageInput = useRef(null)
  const backImageInput = useRef(null)
  const [signInStep, setSignInStep] = useState(1)
  const [signInUsername, setSignInUsername] = useState('')
  const [rememberUsername, setRememberUsername] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState('')
  const [mfaCode, setMfaCode] = useState('')

  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      setAuthUser(session?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset-password')
      } else if (event === 'SIGNED_OUT') {
        setMode(isAdminPath ? 'sign-in' : 'welcome')
      }
    })

    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!isMounted) return
      if (error) {
        setAuthMessage(getFriendlyErrorMessage(error, 'We could not check your secure session. Please try again.'))
        setAuthMessageType('error')
      } else {
        setAuthUser(session?.user ?? null)
        if (session) await continueAuthenticatedSession(session.user)
      }
      setAuthLoading(false)
    }).catch((error) => {
      if (!isMounted) return
      setAuthMessage(getFriendlyErrorMessage(error, 'We could not check your secure session. Please try again.'))
      setAuthMessageType('error')
      setAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function continueAuthenticatedSession(authenticatedUser) {
    try {
      const factor = await getPendingTotpFactor()
      setAuthUser(authenticatedUser)
      if (factor) {
        setMfaFactorId(factor.id)
        setMfaCode('')
        setSignInUsername(authenticatedUser.email || '')
        setMode('mfa-challenge')
      } else {
        setMfaFactorId('')
        setMode('dashboard')
      }
    } catch (error) {
      await supabase?.auth.signOut()
      setAuthUser(null)
      setMode(isAdminPath ? 'sign-in' : 'welcome')
      setAuthMessage(getFriendlyErrorMessage(error, 'We could not verify your sign-in security. Please sign in again.'))
      setAuthMessageType('error')
    }
  }

  function changeMode(nextMode) {
    setMode(nextMode)
    setAuthMessage('')
    setAuthMessageType('error')
    setPhoneType('mobile')
    setSetupStep(1)
    setShowTaxId(false)
    setOpenHint('')
    setMailingAddressDifferent(false)
    setApplicationData({})
    setGovernmentIdType('drivers-license')
    setIdUploadErrors({})
    setDraggingUpload('')
    setFrontImage(null)
    setBackImage(null)
    setSignInStep(1)
    setSignInUsername('')
    setRememberUsername(false)
    setShowPassword(false)
    setShowSignupPassword(false)
    setSignupPassword('')
  }

  function finishLater() {
    changeMode('sign-in')
  }

  function clearApplicationDraft() {
    setApplicationData({})
    setSignupPassword('')
    setFrontImage(null)
    setBackImage(null)
    setShowTaxId(false)
    kycSubmissionRef.current = null
  }

  function finishKycSubmission(email, account, session) {
    clearApplicationDraft()
    if (session) {
      const user = { ...account.user, user_metadata: { ...account.user.user_metadata } }
      delete user.user_metadata.kyc_submission_token
      setAuthUser(user)
      setActionFeedback({
        id: Date.now(),
        kind: 'success',
        message: 'Your application has been securely submitted for review. Account access will be enabled after approval.',
      })
      setMode('dashboard')
      return
    }

    setSignInUsername(email)
    setSignInStep(1)
    setMode('sign-in')
    setAuthMessage('Your application has been securely submitted. Confirm your email before signing in. Account access will be enabled after approval.')
    setAuthMessageType('success')
    setActionFeedback({
      id: Date.now(),
      kind: 'success',
      message: 'Your KYC application and identity documents were submitted for review.',
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (mode === 'create-account') {
      if (setupStep === 1 && !supabase) {
        setAuthMessage(supabaseConfigurationMessage)
        setAuthMessageType('error')
        return
      }
      if (setupStep === 3 && Object.values(idUploadErrors).some(Boolean)) {
        if (idUploadErrors.frontImage) {
          frontImageInput.current?.focus()
        } else {
          backImageInput.current?.focus()
        }
        return
      }

      const submittedValues = Object.fromEntries(new FormData(event.currentTarget).entries())
      if (setupStep === 1) {
        if (submittedValues.password !== submittedValues.passwordConfirmation) {
          setAuthMessage('The passwords do not match.')
          setAuthMessageType('error')
          return
        }
        setSignupPassword(submittedValues.password)
        delete submittedValues.password
        delete submittedValues.passwordConfirmation
      }
      setAuthMessage('')
      setApplicationData((currentData) => ({
        ...currentData,
        ...submittedValues,
        ...(setupStep === 3 && {
          frontImage: frontImage || currentData.frontImage || null,
          backImage: backImage || currentData.backImage || null,
        }),
        ...(setupStep === 4 && {
          mailingAddressDifferent: submittedValues.mailingAddressDifferent === 'on',
        }),
      }))

      if (setupStep === 1) {
        setPhoneType(submittedValues.phoneType)
      }

      if (setupStep < 4) {
        setSetupStep((currentStep) => currentStep + 1)
      } else {
        setSetupStep(5)
      }

      setShowTaxId(false)
      setOpenHint('')
      if (setupStep === 3) {
        setMailingAddressDifferent(Boolean(applicationData.mailingAddressDifferent))
      }
      if (setupStep === 3) {
        setIdUploadErrors({})
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (mode === 'sign-in' && signInStep === 1) {
      const formData = new FormData(event.currentTarget)
      setSignInUsername(formData.get('email').trim())
      setRememberUsername(formData.get('rememberUsername') === 'on')
      setSignInStep(2)
      setAuthMessage('')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (mode === 'sign-in' && signInStep === 2) {
      if (!supabase) {
        setAuthMessage(supabaseConfigurationMessage)
        return
      }

      const password = new FormData(event.currentTarget).get('password')
      setAuthBusy(true)
      setAuthMessage('')
      setAuthMessageType('error')
      let slowNoticeTimer
      let requestTimeout
      try {
        const signInRequest = supabase.auth.signInWithPassword({
          email: signInUsername,
          password,
        })
        const timeoutRequest = new Promise((resolve, reject) => {
          requestTimeout = window.setTimeout(() => reject(new Error('request timeout')), SIGN_IN_TIMEOUT)
        })
        slowNoticeTimer = window.setTimeout(() => {
          setAuthMessage('This is taking longer than usual. Check your internet connection; if you are offline, reconnect and try again.')
          setAuthMessageType('info')
        }, SIGN_IN_SLOW_NOTICE_DELAY)
        const { data, error } = await Promise.race([signInRequest, timeoutRequest])
        if (error) {
          setAuthMessage(getFriendlyErrorMessage(error, 'We could not sign you in. Please try again.'))
          setAuthMessageType('error')
          return
        }
        if (!data.session) {
          setAuthMessage('Sign-in succeeded, but no authenticated session was returned. Please try again.')
          setAuthMessageType('error')
          return
        }
        setAuthMessage('')
        await continueAuthenticatedSession(data.user)
        window.scrollTo({ top: 0 })
      } catch (error) {
        setAuthMessage(getFriendlyErrorMessage(error, 'We could not sign you in. Please try again.'))
        setAuthMessageType('error')
      } finally {
        window.clearTimeout(slowNoticeTimer)
        window.clearTimeout(requestTimeout)
        setAuthBusy(false)
      }
    }

    if (mode === 'mfa-challenge') {
      if (!supabase || !mfaFactorId) {
        setAuthMessage('Your authenticator challenge is unavailable. Sign in again to retry.')
        setAuthMessageType('error')
        return
      }
      const code = String(new FormData(event.currentTarget).get('mfaCode') || '').replace(/\D/g, '')
      setAuthBusy(true)
      setAuthMessage('')
      try {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId })
        if (challengeError) throw challengeError
        const { data, error } = await supabase.auth.mfa.verify({
          factorId: mfaFactorId,
          challengeId: challenge.id,
          code,
        })
        if (error) throw error
        setAuthUser(data.user || authUser)
        setMfaFactorId('')
        setMfaCode('')
        setAuthMessage('')
        setMode('dashboard')
        window.scrollTo({ top: 0 })
      } catch (error) {
        setAuthMessage(getFriendlyErrorMessage(error, 'That authenticator code could not be verified. Try the latest code.'))
        setAuthMessageType('error')
      } finally {
        setAuthBusy(false)
      }
    }

    if (mode === 'reset-password') {
      const formData = new FormData(event.currentTarget)
      const password = formData.get('password')
      if (password !== formData.get('passwordConfirmation')) {
        setAuthMessage('The passwords do not match.')
        return
      }
      setAuthBusy(true)
      setAuthMessage('')
      try {
        const { data, error } = await supabase.auth.updateUser({ password })
        if (error) {
          setAuthMessage(getFriendlyErrorMessage(error, 'We could not update your password. Please try again.'))
          return
        }
        await continueAuthenticatedSession(data.user)
        setActionFeedback({
          kind: 'success',
          message: 'Your password has been updated successfully.',
        })
      } catch (error) {
        setAuthMessage(getFriendlyErrorMessage(error, 'We could not update your password. Please try again.'))
      } finally {
        setAuthBusy(false)
      }
    }
  }

  async function createAccount() {
    if (!supabase) {
      setAuthMessage(supabaseConfigurationMessage)
      setAuthMessageType('error')
      return
    }
    setAuthBusy(true)
    setAuthMessage('')
    const displayName = [applicationData.firstName, applicationData.lastName].filter(Boolean).join(' ')
    const email = applicationData.email.trim().toLowerCase()
    try {
      let account = kycSubmissionRef.current
      let session = account?.session || null
      if (!account) {
        const token = `${crypto.randomUUID()}${crypto.randomUUID()}`
        const { data, error } = await supabase.auth.signUp({
          email,
          password: signupPassword,
          options: {
            emailRedirectTo: getAccountAppRedirectUrl(),
            data: {
              username: applicationData.username.trim().toLowerCase(),
              display_name: displayName,
              phone_number: applicationData.phone.trim(),
              kyc_submission_token: token,
            },
          },
        })
        if (error) {
          setAuthMessage(getFriendlyErrorMessage(error, 'We could not create your account. Please try again.'))
          setAuthMessageType('error')
          return
        }
        if (!data.user) {
          setAuthMessage('Your secure sign-in account was not returned. Please try again.')
          setAuthMessageType('error')
          return
        }
        account = { userId: data.user.id, token, session: data.session, user: data.user }
        kycSubmissionRef.current = account
        session = account.session
      }

      const frontFile = frontImage || applicationData.frontImage
      const backFile = backImage || applicationData.backImage
      const mimeTypeFor = (file) => {
        if (['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) return file.type
        if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg'
        if (/\.png$/i.test(file.name)) return 'image/png'
        return 'application/pdf'
      }
      const selectedFiles = [
        {
          file: frontFile,
          documentType: applicationData.governmentIdType === 'passport'
            ? 'passport'
            : `${applicationData.governmentIdType === 'state-id' ? 'state_id' : 'drivers_license'}_front`,
        },
        ...(applicationData.governmentIdType === 'passport'
          ? (backFile ? [{ file: backFile, documentType: 'passport_back' }] : [])
          : [{
          file: backFile,
          documentType: `${applicationData.governmentIdType === 'state-id' ? 'state_id' : 'drivers_license'}_back`,
        }]),
      ]
      if (selectedFiles.some(({ file }) => !(file instanceof File))) {
        setAuthMessage('Add the required identity document files before submitting.')
        setAuthMessageType('error')
        return
      }

      const fileMetadata = selectedFiles.map(({ file }) => ({
        original_file_name: file.name,
        mime_type: mimeTypeFor(file),
        size_bytes: file.size,
      }))
      const { data: uploadData, error: uploadError } = await supabase.functions.invoke('kyc-submission', {
        body: { action: 'prepare', userId: account.userId, token: account.token, files: fileMetadata },
      })
      if (uploadError || uploadData?.error) {
        setAuthMessage(uploadError
          ? await getFunctionErrorMessage(uploadError)
          : getFriendlyErrorMessage(uploadData.error, 'We could not prepare your identity documents. Please try again.'))
        setAuthMessageType('error')
        return
      }
      if (uploadData?.submitted) {
        finishKycSubmission(email, account, session)
        return
      }
      if (!Array.isArray(uploadData?.uploads) || uploadData.uploads.length !== selectedFiles.length) {
        setAuthMessage('Secure identity document upload could not be prepared. Please try again.')
        setAuthMessageType('error')
        return
      }

      const uploadedDocuments = []
      for (const [index, selected] of selectedFiles.entries()) {
        const upload = uploadData.uploads[index]
        const mimeType = mimeTypeFor(selected.file)
        const { error } = await supabase.storage
          .from('identity-documents')
          .uploadToSignedUrl(upload.path, upload.token, selected.file, { contentType: mimeType })
        if (error) {
          setAuthMessage(getFriendlyErrorMessage(error, 'An identity document could not be uploaded. Please try again.'))
          setAuthMessageType('error')
          return
        }
        uploadedDocuments.push({
          document_type: selected.documentType,
          storage_path: upload.path,
          original_file_name: selected.file.name,
          mime_type: mimeType,
          size_bytes: selected.file.size,
          expires_at: applicationData.governmentIdExpiration,
        })
      }

      const formData = Object.fromEntries(Object.entries(applicationData).filter(([key, value]) => (
        key !== 'frontImage' && key !== 'backImage' && !(value instanceof File)
      )))
      formData.email = email
      formData.username = applicationData.username.trim().toLowerCase()
      formData.frontImage = frontFile.name
      formData.backImage = backFile?.name || ''
      formData.mailingAddressDifferent = Boolean(applicationData.mailingAddressDifferent)
      if (!formData.mailingAddressDifferent) {
        delete formData.mailingStreetAddress
        delete formData.mailingAddressLine2
        delete formData.mailingCity
        delete formData.mailingState
        delete formData.mailingPostalCode
      }

      const { data: submissionData, error: submissionError } = await supabase.functions.invoke('kyc-submission', {
        body: {
          action: 'submit',
          userId: account.userId,
          token: account.token,
          formData,
          documents: uploadedDocuments,
        },
      })
      if (submissionError || submissionData?.error) {
        setAuthMessage(submissionError
          ? await getFunctionErrorMessage(submissionError)
          : getFriendlyErrorMessage(submissionData.error, 'We could not submit your application. Please try again.'))
        setAuthMessageType('error')
        return
      }

      finishKycSubmission(email, account, session)
    } catch (error) {
      setAuthMessage(getFriendlyErrorMessage(error, 'We could not create your account. Please try again.'))
      setAuthMessageType('error')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleForgotPassword() {
    if (!supabase) {
      setAuthMessage(supabaseConfigurationMessage)
      return
    }
    if (!signInUsername.trim()) {
      setAuthMessage('Enter your email address first, then select Forgot password.')
      setAuthMessageType('error')
      return
    }
    setAuthBusy(true)
    setAuthMessage('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(signInUsername.trim(), {
        redirectTo: getAccountAppRedirectUrl(),
      })
      if (error) {
        setAuthMessage(getFriendlyErrorMessage(error, 'We could not send a reset link. Please try again.'))
        return
      }
      setAuthMessage('If an account exists for that email, a password reset link has been sent.')
      setAuthMessageType('success')
      setActionFeedback({
        id: Date.now(),
        kind: 'success',
        message: 'If an account exists for this email, password reset instructions have been sent. Check your inbox.',
      })
    } catch (error) {
      setAuthMessage(getFriendlyErrorMessage(error, 'We could not send a reset link. Please try again.'))
      setAuthMessageType('error')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      clearApplicationDraft()
      setMode(isAdminPath ? 'sign-in' : 'welcome')
      setAuthUser(null)
      return
    }
    setAuthBusy(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        const message = getFriendlyErrorMessage(error, 'We could not sign you out. Please try again.')
        setAuthMessage(message)
        return message
      }
      clearApplicationDraft()
      setAuthUser(null)
      setMode(isAdminPath ? 'sign-in' : 'welcome')
      return null
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'We could not sign you out. Please try again.')
      setAuthMessage(message)
      return message
    } finally {
      setAuthBusy(false)
    }
  }

  function handleIdFileChange(kind, file) {
    if (!file) return

    if (file.size > MAX_ID_FILE_SIZE) {
      setIdUploadErrors((currentErrors) => ({
        ...currentErrors,
        [kind]: 'This file is larger than 10 MB. Choose a smaller file.',
      }))
      return
    }

    if (file.size === 0) {
      setIdUploadErrors((currentErrors) => ({
        ...currentErrors,
        [kind]: 'This file is empty. Choose a different file.',
      }))
      return
    }

    if (!isAllowedIdFile(file)) {
      setIdUploadErrors((currentErrors) => ({
        ...currentErrors,
        [kind]: 'Choose a JPG, PNG, or PDF file.',
      }))
      return
    }

    setIdUploadErrors((currentErrors) => ({ ...currentErrors, [kind]: '' }))
    if (kind === 'frontImage') {
      setFrontImage(file)
    } else {
      setBackImage(file)
    }
  }

  function removeIdFile(kind) {
    if (kind === 'frontImage') {
      setFrontImage(null)
      if (frontImageInput.current) frontImageInput.current.value = ''
    } else {
      setBackImage(null)
      if (backImageInput.current) backImageInput.current.value = ''
    }
    setApplicationData((currentData) => ({ ...currentData, [kind]: null }))
    setIdUploadErrors((currentErrors) => ({ ...currentErrors, [kind]: '' }))
  }

  const savedFrontImage = frontImage || applicationData.frontImage
  const savedBackImage = backImage || applicationData.backImage

  if (authLoading) {
    return <main className="account-app account-app--welcome" aria-live="polite">Checking secure session…</main>
  }

  if (isAdminPath && authUser && mode === 'dashboard') {
    if (isAdminUser(authUser)) {
      return <AdminLayout onSignOut={handleSignOut} user={authUser} />
    }

    return <AdminAccessDenied onSignOut={handleSignOut} />
  }

  if (mode === 'dashboard' && authUser) {
    return (
      <main className="account-app account-app--dashboard">
        <Dashboard onSignOut={handleSignOut} user={authUser} />
        {actionFeedback && (
          <ActionToast
            key={actionFeedback.id || actionFeedback.message}
            kind={actionFeedback.kind}
            message={actionFeedback.message}
            onDismiss={dismissActionFeedback}
          />
        )}
      </main>
    )
  }

  if (mode === 'dashboard' && !authUser) {
    return <main className="account-app account-app--welcome" aria-live="polite">Checking secure session…</main>
  }

  return (
    <main className={`account-app${mode === 'create-account' ? ' account-app--setup' : mode === 'welcome' ? ' account-app--welcome' : mode === 'sign-in' || mode === 'reset-password' ? ' account-app--sign-in' : ''}`}>
      {actionFeedback && (
        <ActionToast
          key={actionFeedback.id || actionFeedback.message}
          kind={actionFeedback.kind}
          message={actionFeedback.message}
          onDismiss={dismissActionFeedback}
        />
      )}
      <header className="account-app__header">
        <div className="account-app__header-brand">
          <a className="account-app__brand" href="/" aria-label="Cedarline home">
            <span className="account-app__brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Cedarline
          </a>
        </div>
        <div className="account-app__header-actions">
          <div className="account-app__help-wrap">
            <button
              className="account-app__help-button"
              type="button"
            >
              Need help?
              <span aria-hidden="true">▾</span>
            </button>
          </div>
          {mode === 'create-account' ? (
            <button
              className="account-app__finish-button"
              onClick={finishLater}
              type="button"
            >
              Finish later
            </button>
          ) : null}
        </div>
      </header>

      {mode === 'welcome' ? (
        <section className="account-app__welcome-card" aria-labelledby="welcome-title">
          <div className="account-app__welcome-content">
            <div className="account-app__welcome-icon" aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none">
                <path d="M16 27c0-9 8-15 20-15 8 0 15 4 18 11l5 2 2 8-4 4h-4c-2 8-9 13-19 13-3 0-6-.5-8.5-1.5L19 54c-4 0-6-4-4-7l2-3c-3-4-5-9-5-14l-4-2c-2-2-1-5 2-6l6-1Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M30 13c-1-6 3-10 8-10 5 0 8 4 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="46" cy="25" r="2.5" fill="var(--account-green)" />
                <path d="M23 25c2-2 4-2 6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="account-app__welcome-main">
              <h1 id="welcome-title">Let’s get started!</h1>
              <p className="account-app__welcome-description">
                Start a new Cedarline account application. Have the following information ready to complete the application.
              </p>

              <h2>What you’ll need:</h2>
              <ul className="account-app__requirements">
                <li>
                  <svg aria-hidden="true" viewBox="0 0 40 36" fill="none">
                    <rect x="3" y="5" width="34" height="26" rx="1" />
                    <path d="m4 7 16 13L36 7" />
                  </svg>
                  <span>Email address</span>
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 40 40" fill="none">
                    <rect x="6" y="17" width="28" height="19" rx="2" />
                    <path d="M11 17v-5a9 9 0 0 1 18 0v5M11 25h18M11 30h18" />
                  </svg>
                  <span>Tax ID (SSN or ITIN)</span>
                </li>
                <li>
                  <svg aria-hidden="true" viewBox="0 0 40 36" fill="none">
                    <rect x="2.5" y="5" width="35" height="26" rx="1" />
                    <circle cx="12" cy="14" r="4" />
                    <path d="M6 27c0-4 2-7 6-7s6 3 6 7m5-12h10m-10 6h10m-10 6h7" />
                  </svg>
                  <span>
                    Personal identification
                    <small>                    (driver’s license, state ID, or passport)</small>
                  </span>
                </li>
              </ul>

              <p className="account-app__customer-question">
                Are you an existing Cedarline customer or a new customer?
              </p>
              <div className="account-app__customer-actions">
                <button className="account-app__customer-button" onClick={() => changeMode('sign-in')} type="button">
                  Existing Customer
                </button>
                <button className="account-app__customer-button" onClick={() => changeMode('create-account')} type="button">
                  New Customer
                </button>
              </div>

            </div>
          </div>
        </section>
      ) : mode === 'create-account' ? (
        <section className="account-app__setup-card" aria-labelledby="form-title">
          <div
            aria-label={`${Math.min(setupStep * 20, 100)}% complete`}
            className="account-app__progress"
            role="img"
          >
            <span>{Math.min(setupStep * 20, 100)}%</span>
            <span className="account-app__progress-track">
              <span className="account-app__progress-fill" style={{ width: `${Math.min(setupStep * 20, 100)}%` }} />
              <svg
                className="account-app__progress-bike"
                style={{ left: `${Math.min(setupStep * 20, 100)}%` }}
                viewBox="0 0 56 32"
                aria-hidden="true"
              >
                <circle cx="13" cy="22" r="8" />
                <circle cx="43" cy="22" r="8" />
                <path d="m13 22 9-13 8 13H13l8-9h13l9 9M19 6h7m5 3 3-4" />
              </svg>
            </span>
          </div>
          <div className="account-app__setup-content">
            <div className="account-app__setup-icon" aria-hidden="true">
              {setupStep === 1 ? (
                <svg viewBox="0 0 40 48" fill="none">
                  <rect x="9" y="2" width="22" height="38" rx="2" />
                  <path d="M17 7h6M18 44h4M2 19l7 7m22-5 7 7M4 29l6 5m20-3 6 5" />
                </svg>
              ) : setupStep === 2 ? (
                <svg viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="21" />
                  <path d="M15 37c1-5 5-6 9-8v-3c-2-1-3-4-3-7-1-1-1-4 1-4 0-6 3-9 7-9s7 3 7 9c2 0 2 3 1 4 0 3-1 6-3 7v3c4 2 8 3 9 8" transform="translate(-5 2) scale(.9)" />
                </svg>
              ) : setupStep === 3 ? (
                <svg viewBox="0 0 40 48" fill="none">
                  <rect x="4" y="7" width="32" height="34" rx="2" />
                  <circle cx="14" cy="20" r="4" />
                  <path d="M8 33c0-4 2-6 6-6s6 2 6 6m4-13h7m-7 6h7m-7 6h7" />
                </svg>
              ) : setupStep === 4 ? (
                <svg viewBox="0 0 40 48" fill="none">
                <path d="M32 20c0 9-12 22-12 22S8 29 8 20a12 12 0 1 1 24 0Z" />
                <circle cx="20" cy="20" r="4" />
                </svg>
              ) : (
                <svg viewBox="0 0 40 48" fill="none">
                <path d="M9 3h15l8 8v34H9zM24 3v9h8M15 22h11m-11 7h11m-11 7h7" />
                </svg>
              )}
            </div>
            <div className="account-app__setup-main">
              <p className="account-app__eyebrow">Step {setupStep}</p>
              <h1 id="form-title">
                {setupStep === 1
                  ? 'Contact information'
                  : setupStep === 2
                    ? 'Personal information'
                    : setupStep === 3
                        ? 'Government ID'
                        : setupStep === 4
                        ? 'Address information'
                        : 'Review your information'}
              </h1>
              <p className="account-app__setup-description">
                {setupStep === 1
                  ? 'We need this information to determine who will be on your new Cedarline account.'
                  : setupStep === 2
                    ? 'We need this information to verify your identity and eligibility for a new account.'
                    : setupStep === 3
                      ? 'Provide a government-issued ID so we can verify your identity.'
                      : setupStep === 4
                        ? 'Enter the residential address for this account.'
                        : 'Check the information below before continuing.'}
              </p>
              {setupStep < 5 && (
                <p className="account-app__required-note">
                  All fields are required unless noted otherwise.
                </p>
              )}

              {setupStep === 1 ? (
                <>
                  <div className="account-app__contact-note">
                    <span className="account-app__people-icon" aria-hidden="true">◎</span>
                    <p>
                      <strong>Note:</strong> After opening this account, you can add
                      another account owner.
                    </p>
                  </div>

                  <form className="account-app__form account-app__form--setup" key="contact-information" onSubmit={handleSubmit}>
                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="firstName">First name</label>
                  <input
                    autoComplete="given-name"
                    defaultValue={applicationData.firstName || ''}
                    id="firstName"
                    name="firstName"
                    placeholder="First name (e.g., Jordan)"
                    required
                    type="text"
                  />
                </div>
                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="lastName">Last name</label>
                  <input
                    autoComplete="family-name"
                    defaultValue={applicationData.lastName || ''}
                    id="lastName"
                    name="lastName"
                    placeholder="Last name (e.g., Lee)"
                    required
                    type="text"
                  />
                </div>

                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="email">Email address</label>
                  <input
                    autoComplete="email"
                    defaultValue={applicationData.email || ''}
                    id="email"
                    name="email"
                    placeholder="Email (e.g., jordan@example.com)"
                    required
                    type="email"
                  />
                </div>
                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="username">Username</label>
                  <input
                    autoComplete="username"
                    defaultValue={applicationData.username || ''}
                    id="username"
                    maxLength={32}
                    minLength={3}
                    name="username"
                    pattern="[A-Za-z0-9_]+"
                    placeholder="Username (3–32 letters, numbers, or _)"
                    required
                    title="Use 3–32 letters, numbers, or underscores."
                  />
                  <span className="account-app__field-hint">Use 3–32 letters, numbers, or underscores.</span>
                </div>
                <div className="account-app__field account-app__field--inline-action">
                  <label className="account-app__visually-hidden" htmlFor="signupPassword">Create password</label>
                  <input
                    autoComplete="new-password"
                    id="signupPassword"
                    minLength={12}
                    name="password"
                    placeholder="Create password (12+ characters)"
                    required
                    type={showSignupPassword ? 'text' : 'password'}
                  />
                  <span className="account-app__field-hint">Use at least 12 characters. A unique passphrase is recommended.</span>
                  <button
                    aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                    className="account-app__field-action"
                    onClick={() => setShowSignupPassword((show) => !show)}
                    type="button"
                  >
                    {showSignupPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="signupPasswordConfirmation">Confirm password</label>
                  <input
                    autoComplete="new-password"
                    id="signupPasswordConfirmation"
                    minLength={12}
                    name="passwordConfirmation"
                    placeholder="Confirm password"
                    required
                    type="password"
                  />
                  <span className="account-app__field-hint">Enter the same password again.</span>
                </div>

                <fieldset className="account-app__phone-type">
                  <legend>Phone number type</legend>
                  <label>
                    <input
                      checked={phoneType === 'mobile'}
                      name="phoneType"
                      onChange={() => setPhoneType('mobile')}
                      type="radio"
                      value="mobile"
                    />
                    <span>Mobile</span>
                  </label>
                  <label>
                    <input
                      checked={phoneType === 'home'}
                      name="phoneType"
                      onChange={() => setPhoneType('home')}
                      type="radio"
                      value="home"
                    />
                    <span>Home</span>
                  </label>
                </fieldset>
                <div className="account-app__field">
                  <label className="account-app__visually-hidden" htmlFor="phone">
                    {phoneType === 'mobile' ? 'Mobile' : 'Home'} phone number
                  </label>
                  <div className="account-app__phone-input">
                    <span className="account-app__phone-country-code">+1</span>
                    <input
                      autoComplete="tel-national"
                      id="phone"
                      inputMode="numeric"
                      maxLength={12}
                      name="phone"
                      onChange={(event) => setApplicationData((current) => ({
                        ...current,
                        phone: formatUsPhoneInput(event.target.value),
                      }))}
                      placeholder="205-555-5555"
                      required
                      type="tel"
                      value={formatUsPhoneInput(applicationData.phone)}
                    />
                  </div>
                  <span className="account-app__field-hint">Enter your 10-digit US phone number. The +1 country code is included.</span>
                </div>

                {authMessage && authMessageType === 'error' && (
                  <p className="account-app__auth-message" role="alert">{authMessage}</p>
                )}
                <p className="account-app__auth-scope-note" role="note">
                  Your application details and identity documents are submitted securely for review when you create your account.
                </p>
                <div className="account-app__setup-actions">
                  <button
                    className="account-app__back-button"
                    onClick={() => changeMode('welcome')}
                    type="button"
                  >
                    Back
                  </button>
                  <button className="account-app__submit" type="submit">
                    Next
                  </button>
                </div>
                  </form>
                </>
              ) : setupStep === 2 ? (
                <form className="account-app__form account-app__form--setup account-app__form--personal" key="personal-information" onSubmit={handleSubmit}>
                  <div className="account-app__field account-app__field--inline-action">
                    <label className="account-app__visually-hidden" htmlFor="taxId">Tax ID (SSN or ITIN)</label>
                    <input
                      autoComplete="off"
                      aria-describedby="taxIdHint"
                      id="taxId"
                      inputMode="numeric"
                      maxLength={11}
                      name="taxId"
                      onChange={(event) => setApplicationData((current) => ({
                        ...current,
                        taxId: formatUsTaxIdInput(event.target.value),
                      }))}
                      pattern="[0-9]{3}-[0-9]{2}-[0-9]{4}"
                      placeholder="Tax ID (9 digits; XXX-XX-XXXX)"
                      required
                      type={showTaxId ? 'text' : 'password'}
                      value={formatUsTaxIdInput(applicationData.taxId)}
                    />
                    <button
                      aria-label={showTaxId ? 'Hide Tax ID' : 'Show Tax ID'}
                      className="account-app__field-action"
                      onClick={() => setShowTaxId(!showTaxId)}
                      type="button"
                    >
                      {showTaxId ? 'Hide' : 'Show'}
                    </button>
                    <span className="account-app__field-hint" id="taxIdHint">
                      Enter 9 digits, optionally formatted as XXX-XX-XXXX. We use this for identity verification and never display the full number.
                    </span>
                  </div>

                  <div className="account-app__field account-app__field--hint">
                    <label className="account-app__visually-hidden" htmlFor="dateOfBirth">Date of Birth</label>
                    <input
                      autoComplete="bday"
                      id="dateOfBirth"
                      inputMode="numeric"
                      maxLength={10}
                      name="dateOfBirth"
                      onChange={(event) => setApplicationData((current) => ({
                        ...current,
                        dateOfBirth: formatBirthDateInput(event.target.value),
                      }))}
                      placeholder="Date of birth (MM/DD/YYYY)"
                      required
                      type="text"
                      pattern="(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/[0-9]{4}"
                      value={formatBirthDateInput(applicationData.dateOfBirth)}
                    />
                    <span className="account-app__field-hint">
                      Please enter the month, day, and year using this format: MM/DD/YYYY.
                    </span>
                    <button
                      aria-expanded={openHint === 'birth'}
                      aria-label="Date of birth help"
                      className="account-app__hint-button"
                      onClick={() => setOpenHint(openHint === 'birth' ? '' : 'birth')}
                      type="button"
                    >
                      ?
                    </button>
                    {openHint === 'birth' && (
                      <span className="account-app__hint-popover" role="status">
                        Enter your date of birth as month, day, and four-digit year.
                      </span>
                    )}
                  </div>

                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="employmentStatus">Employment Status</label>
                    <select aria-label="Employment status" id="employmentStatus" name="employmentStatus" defaultValue={applicationData.employmentStatus || ''} required>
                      <option value="" disabled>Employment Status</option>
                      <option value="employed">Employed</option>
                      <option value="self-employed">Self-employed</option>
                      <option value="unemployed">Unemployed</option>
                      <option value="retired">Retired</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <fieldset className="account-app__choice-fieldset">
                    <legend>Are you a student?</legend>
                    <label>
                      <input defaultChecked={applicationData.isStudent === 'yes'} name="isStudent" type="radio" value="yes" required />
                      <span>Yes</span>
                    </label>
                    <label>
                      <input defaultChecked={applicationData.isStudent === 'no'} name="isStudent" type="radio" value="no" />
                      <span>No</span>
                    </label>
                  </fieldset>

                  <div className="account-app__field account-app__field--inline-action">
                    <label className="account-app__visually-hidden" htmlFor="promoCode">Promo Code (optional)</label>
                    <input autoComplete="off" defaultValue={applicationData.promoCode || ''} id="promoCode" name="promoCode" placeholder="Promo code (optional)" />
                    <button
                      aria-expanded={openHint === 'promo'}
                      aria-label="Promo code help"
                      className="account-app__hint-button"
                      onClick={() => setOpenHint(openHint === 'promo' ? '' : 'promo')}
                      type="button"
                    >
                      ?
                    </button>
                    {openHint === 'promo' && (
                      <span className="account-app__hint-popover" role="status">
                        Enter the promotion code exactly as provided (letters and numbers).
                      </span>
                    )}
                  </div>

                  <div className="account-app__field account-app__field--inline-action">
                    <label className="account-app__visually-hidden" htmlFor="bankerId">Banker ID (optional)</label>
                    <input autoComplete="off" defaultValue={applicationData.bankerId || ''} id="bankerId" name="bankerId" placeholder="Banker ID (optional)" />
                    <button
                      aria-expanded={openHint === 'banker'}
                      aria-label="Banker ID help"
                      className="account-app__hint-button"
                      onClick={() => setOpenHint(openHint === 'banker' ? '' : 'banker')}
                      type="button"
                    >
                      ?
                    </button>
                    {openHint === 'banker' && (
                      <span className="account-app__hint-popover" role="status">
                        Enter the banker ID exactly as provided by your Cedarline banker.
                      </span>
                    )}
                  </div>

                  <div className="account-app__setup-actions">
                    <button
                      className="account-app__back-button"
                      onClick={() => {
                        setSetupStep(1)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      type="button"
                    >
                      Back
                    </button>
                    <button className="account-app__submit" type="submit">
                      Next
                    </button>
                  </div>
                </form>
              ) : setupStep === 3 ? (
                <form className="account-app__form account-app__form--setup account-app__form--government-id" key="government-id" onSubmit={handleSubmit}>
                  <fieldset className="account-app__id-section">
                    <legend>Government ID</legend>
                    <div className="account-app__id-fields">
                      <div className="account-app__field">
                        <label htmlFor="governmentIdType">Document type</label>
                        <select
                          id="governmentIdType"
                          name="governmentIdType"
                          onChange={(event) => setGovernmentIdType(event.target.value)}
                          required
                          value={governmentIdType}
                        >
                          <option value="drivers-license">Driver’s License</option>
                          <option value="state-id">State ID</option>
                          <option value="passport">Passport</option>
                        </select>
                      </div>
                      <div className="account-app__field">
                        <label htmlFor="governmentIdNumber">Document number</label>
                        <input
                          autoComplete="off"
                          defaultValue={applicationData.governmentIdNumber || ''}
                          id="governmentIdNumber"
                          name="governmentIdNumber"
                          placeholder="Document number (as shown on ID)"
                          required
                          type="text"
                        />
                        <span className="account-app__field-hint">Enter the number exactly as printed on your selected document.</span>
                      </div>
                      <div className="account-app__field">
                        <label htmlFor="governmentIdExpiration">Expiration date</label>
                        <input
                          defaultValue={applicationData.governmentIdExpiration || ''}
                          id="governmentIdExpiration"
                          name="governmentIdExpiration"
                          required
                          type="date"
                        />
                        <span className="account-app__field-hint">Select the expiration date printed on your ID.</span>
                      </div>
                    </div>

                    <div className="account-app__upload-grid">
                      <div
                        className={`account-app__upload${draggingUpload === 'frontImage' ? ' account-app__upload--dragging' : ''}${idUploadErrors.frontImage ? ' account-app__upload--error' : ''}`}
                        onDragEnter={(event) => {
                          event.preventDefault()
                          setDraggingUpload('frontImage')
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setDraggingUpload('')
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          setDraggingUpload('')
                          handleIdFileChange('frontImage', event.dataTransfer.files[0])
                        }}
                      >
                        <input
                          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                          aria-describedby={`frontImageHelp${idUploadErrors.frontImage ? ' frontImageError' : ''}`}
                          aria-invalid={Boolean(idUploadErrors.frontImage)}
                          className="account-app__upload-input"
                          id="frontImage"
                          onChange={(event) => handleIdFileChange('frontImage', event.target.files[0])}
                          ref={frontImageInput}
                          required={!savedFrontImage}
                          type="file"
                        />
                        <label className="account-app__upload-label" htmlFor="frontImage">
                          <span className="account-app__upload-title">Front image <span aria-hidden="true">*</span></span>
                          <span>Drop a file here or <span className="account-app__upload-link">browse</span></span>
                        </label>
                        <span className="account-app__field-hint" id="frontImageHelp">JPG, PNG, or PDF · Max 10 MB</span>
                        {savedFrontImage && (
                          <div className="account-app__upload-file">
                            <span title={savedFrontImage.name}>{savedFrontImage.name}</span>
                            <button className="account-app__text-button" onClick={() => removeIdFile('frontImage')} type="button">Remove</button>
                          </div>
                        )}
                        {idUploadErrors.frontImage && <span className="account-app__upload-error" id="frontImageError" role="alert">{idUploadErrors.frontImage}</span>}
                      </div>

                      <div
                        className={`account-app__upload${draggingUpload === 'backImage' ? ' account-app__upload--dragging' : ''}${idUploadErrors.backImage ? ' account-app__upload--error' : ''}`}
                        onDragEnter={(event) => {
                          event.preventDefault()
                          setDraggingUpload('backImage')
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setDraggingUpload('')
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          setDraggingUpload('')
                          handleIdFileChange('backImage', event.dataTransfer.files[0])
                        }}
                      >
                        <input
                          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                          aria-describedby={`backImageHelp${idUploadErrors.backImage ? ' backImageError' : ''}`}
                          aria-invalid={Boolean(idUploadErrors.backImage)}
                          className="account-app__upload-input"
                          id="backImage"
                          onChange={(event) => handleIdFileChange('backImage', event.target.files[0])}
                          ref={backImageInput}
                          required={governmentIdType !== 'passport' && !savedBackImage}
                          type="file"
                        />
                        <label className="account-app__upload-label" htmlFor="backImage">
                          <span className="account-app__upload-title">Back image {governmentIdType !== 'passport' && <span aria-hidden="true">*</span>}</span>
                          <span>Drop a file here or <span className="account-app__upload-link">browse</span></span>
                        </label>
                        <span className="account-app__field-hint" id="backImageHelp">
                          {governmentIdType === 'passport' ? 'Optional for passports' : 'Required for Driver’s License and State ID'}
                          {' · '}JPG, PNG, or PDF · Max 10 MB
                        </span>
                        {savedBackImage && (
                          <div className="account-app__upload-file">
                            <span title={savedBackImage.name}>{savedBackImage.name}</span>
                            <button className="account-app__text-button" onClick={() => removeIdFile('backImage')} type="button">Remove</button>
                          </div>
                        )}
                        {idUploadErrors.backImage && <span className="account-app__upload-error" id="backImageError" role="alert">{idUploadErrors.backImage}</span>}
                      </div>
                    </div>
                  </fieldset>

                  <div className="account-app__setup-actions">
                    <button
                      className="account-app__back-button"
                      onClick={() => {
                        setSetupStep(2)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      type="button"
                    >
                      Back
                    </button>
                    <button className="account-app__submit" type="submit">
                      Next
                    </button>
                  </div>
                </form>
              ) : setupStep === 4 ? (
                <form className="account-app__form account-app__form--setup account-app__form--address" key="address-information" onSubmit={handleSubmit}>
                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="streetAddress">Street address</label>
                    <input
                      autoComplete="address-line1"
                      defaultValue={applicationData.streetAddress || ''}
                      id="streetAddress"
                      name="streetAddress"
                      placeholder="Street address (e.g., 123 Oak Street)"
                      required
                    />
                  </div>
                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="addressLine2">Apartment, suite, or unit (optional)</label>
                    <input
                      autoComplete="address-line2"
                      defaultValue={applicationData.addressLine2 || ''}
                      id="addressLine2"
                      name="addressLine2"
                      placeholder="Apartment, suite, or unit (e.g., Apt 4B; optional)"
                    />
                  </div>
                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="city">City</label>
                    <input
                      autoComplete="address-level2"
                      defaultValue={applicationData.city || ''}
                      id="city"
                      name="city"
                      placeholder="City (e.g., Austin)"
                      required
                    />
                  </div>
                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="state">State</label>
                    <input
                      autoComplete="address-level1"
                      defaultValue={applicationData.state || ''}
                      id="state"
                      name="state"
                      placeholder="State abbreviation (e.g., TX)"
                      required
                    />
                  </div>
                  <div className="account-app__field">
                    <label className="account-app__visually-hidden" htmlFor="postalCode">ZIP Code</label>
                    <input
                      autoComplete="postal-code"
                      defaultValue={applicationData.postalCode || ''}
                      id="postalCode"
                      inputMode="numeric"
                      name="postalCode"
                      pattern="[0-9]{5}(-[0-9]{4})?"
                      placeholder="ZIP Code"
                      required
                    />
                    <span className="account-app__field-hint">Enter 5 digits (12345) or ZIP+4 (12345-6789).</span>
                  </div>
                  <label className="account-app__checkbox">
                    <input
                      checked={mailingAddressDifferent}
                      onChange={(event) => setMailingAddressDifferent(event.target.checked)}
                      name="mailingAddressDifferent"
                      type="checkbox"
                    />
                    <span>My mailing address is different</span>
                  </label>
                  {mailingAddressDifferent && (
                    <>
                      <div className="account-app__field">
                        <label className="account-app__visually-hidden" htmlFor="mailingStreetAddress">Mailing street address</label>
                        <input
                          autoComplete="section-mailing address-line1"
                            defaultValue={applicationData.mailingStreetAddress || ''}
                            id="mailingStreetAddress"
                          name="mailingStreetAddress"
                          placeholder="Mailing street address (e.g., 123 Oak Street)"
                          required
                        />
                      </div>
                      <div className="account-app__field">
                        <label className="account-app__visually-hidden" htmlFor="mailingAddressLine2">Mailing apartment, suite, or unit (optional)</label>
                        <input
                          autoComplete="section-mailing address-line2"
                            defaultValue={applicationData.mailingAddressLine2 || ''}
                            id="mailingAddressLine2"
                          name="mailingAddressLine2"
                          placeholder="Apartment, suite, or unit (e.g., Apt 4B; optional)"
                        />
                      </div>
                      <div className="account-app__field">
                        <label className="account-app__visually-hidden" htmlFor="mailingCity">Mailing city</label>
                        <input
                          autoComplete="section-mailing address-level2"
                            defaultValue={applicationData.mailingCity || ''}
                            id="mailingCity"
                          name="mailingCity"
                          placeholder="Mailing city (e.g., Austin)"
                          required
                        />
                      </div>
                      <div className="account-app__field">
                        <label className="account-app__visually-hidden" htmlFor="mailingState">Mailing state</label>
                        <input
                          autoComplete="section-mailing address-level1"
                            defaultValue={applicationData.mailingState || ''}
                            id="mailingState"
                          name="mailingState"
                          placeholder="Mailing state abbreviation (e.g., TX)"
                          required
                        />
                      </div>
                      <div className="account-app__field">
                        <label className="account-app__visually-hidden" htmlFor="mailingPostalCode">Mailing ZIP Code</label>
                        <input
                          autoComplete="section-mailing postal-code"
                            defaultValue={applicationData.mailingPostalCode || ''}
                            id="mailingPostalCode"
                          inputMode="numeric"
                          name="mailingPostalCode"
                          pattern="[0-9]{5}(-[0-9]{4})?"
                          placeholder="Mailing ZIP Code"
                          required
                        />
                        <span className="account-app__field-hint">Enter 5 digits (12345) or ZIP+4 (12345-6789).</span>
                      </div>
                    </>
                  )}
                  <div className="account-app__setup-actions">
                    <button
                      className="account-app__back-button"
                      onClick={() => {
                        setSetupStep(3)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      type="button"
                    >
                      Back
                    </button>
                    <button className="account-app__submit" type="submit">
                      Next
                    </button>
                  </div>
                </form>
              ) : (
                <div className="account-app__review">
                  <section className="account-app__review-section" aria-labelledby="review-contact">
                    <div className="account-app__review-heading">
                      <h2 id="review-contact">Contact information</h2>
                      <button className="account-app__text-button" onClick={() => {
                        setSetupStep(1)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }} type="button">Edit</button>
                    </div>
                    <dl className="account-app__review-list">
                      <div><dt>Name</dt><dd>{[applicationData.firstName, applicationData.lastName].filter(Boolean).join(' ')}</dd></div>
                      <div><dt>Email address</dt><dd>{applicationData.email}</dd></div>
                      <div><dt>{applicationData.phoneType === 'home' ? 'Home' : 'Mobile'} phone</dt><dd>{applicationData.phone}</dd></div>
                    </dl>
                  </section>

                  <section className="account-app__review-section" aria-labelledby="review-personal">
                    <div className="account-app__review-heading">
                      <h2 id="review-personal">Personal information</h2>
                      <button className="account-app__text-button" onClick={() => {
                        setSetupStep(2)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }} type="button">Edit</button>
                    </div>
                    <dl className="account-app__review-list">
                      <div><dt>Tax ID (SSN or ITIN)</dt><dd>{applicationData.taxId ? 'Provided (not displayed)' : 'Not provided'}</dd></div>
                      <div><dt>Date of birth</dt><dd>{applicationData.dateOfBirth}</dd></div>
                      <div><dt>Employment status</dt><dd>{({
                        employed: 'Employed',
                        'self-employed': 'Self-employed',
                        unemployed: 'Unemployed',
                        retired: 'Retired',
                        other: 'Other',
                      })[applicationData.employmentStatus]}</dd></div>
                      <div><dt>Student</dt><dd>{applicationData.isStudent === 'yes' ? 'Yes' : 'No'}</dd></div>
                      {applicationData.promoCode && <div><dt>Promo code</dt><dd>{applicationData.promoCode}</dd></div>}
                      {applicationData.bankerId && <div><dt>Banker ID</dt><dd>{applicationData.bankerId}</dd></div>}
                    </dl>
                  </section>

                  <section className="account-app__review-section" aria-labelledby="review-government-id">
                    <div className="account-app__review-heading">
                      <h2 id="review-government-id">Government ID</h2>
                      <button className="account-app__text-button" onClick={() => {
                        setSetupStep(3)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }} type="button">Edit</button>
                    </div>
                    <dl className="account-app__review-list">
                      <div>
                        <dt>Document type</dt>
                        <dd>{({
                          'drivers-license': 'Driver’s License',
                          'state-id': 'State ID',
                          passport: 'Passport',
                        })[applicationData.governmentIdType]}</dd>
                      </div>
                      <div><dt>Document number</dt><dd>{applicationData.governmentIdNumber ? 'Provided (not displayed)' : 'Not provided'}</dd></div>
                      <div><dt>Expiration date</dt><dd>{applicationData.governmentIdExpiration}</dd></div>
                      <div><dt>Front image</dt><dd>{applicationData.frontImage?.name || 'Not provided'}</dd></div>
                      {applicationData.governmentIdType !== 'passport' && (
                        <div><dt>Back image</dt><dd>{applicationData.backImage?.name || 'Not provided'}</dd></div>
                      )}
                    </dl>
                  </section>

                  <section className="account-app__review-section" aria-labelledby="review-address">
                    <div className="account-app__review-heading">
                      <h2 id="review-address">Address information</h2>
                      <button
                        className="account-app__text-button"
                        onClick={() => {
                          setMailingAddressDifferent(Boolean(applicationData.mailingAddressDifferent))
                          setSetupStep(4)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="account-app__review-list">
                      <div>
                        <dt>Residential address</dt>
                        <dd>
                          {[applicationData.streetAddress, applicationData.addressLine2, [applicationData.city, applicationData.state].filter(Boolean).join(', '), applicationData.postalCode].filter(Boolean).join(', ')}
                        </dd>
                      </div>
                      {applicationData.mailingAddressDifferent && (
                        <div>
                          <dt>Mailing address</dt>
                          <dd>
                            {[applicationData.mailingStreetAddress, applicationData.mailingAddressLine2, [applicationData.mailingCity, applicationData.mailingState].filter(Boolean).join(', '), applicationData.mailingPostalCode].filter(Boolean).join(', ')}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </section>

                  <p className="account-app__auth-scope-note" role="note">
                    Your application details and identity documents are submitted securely for review when you create your account.
                  </p>
                  {authMessage && authMessageType === 'error' && (
                    <p className={`account-app__auth-message${authMessageType === 'success' ? ' account-app__auth-message--success' : ''}`} role={authMessageType === 'error' ? 'alert' : 'status'}>
                      {authMessage}
                    </p>
                  )}
                  <div className="account-app__setup-actions">
                    <button
                      className="account-app__back-button"
                      onClick={() => {
                        setMailingAddressDifferent(Boolean(applicationData.mailingAddressDifferent))
                        setSetupStep(4)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      type="button"
                    >
                      Back
                    </button>
                    <button
                      className="account-app__submit"
                      type="button"
                      disabled={authBusy}
                      onClick={createAccount}
                    >
                      {authBusy ? 'Creating account…' : 'Create account'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : mode === 'mfa-challenge' ? (
        <div className="account-app__login-page">
          <section className="account-app__login-heading" aria-labelledby="form-title">
            <h1 id="form-title">Verify it’s you</h1>
            <p>Enter the current code from your authenticator app to continue.</p>
          </section>
          <section className="account-app__login-card" aria-label="Authenticator verification">
            <form className="account-app__login-form" onSubmit={handleSubmit}>
              {authMessage && <p className="account-app__auth-message" role="alert">{authMessage}</p>}
              <div className="account-app__field">
                <label htmlFor="mfaCode">6-digit authenticator code</label>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  id="mfaCode"
                  inputMode="numeric"
                  maxLength={6}
                  name="mfaCode"
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  value={mfaCode}
                />
              </div>
              <button className="account-app__login-continue" disabled={authBusy} type="submit">
                {authBusy ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button
                className="account-app__text-button"
                disabled={authBusy}
                onClick={async () => {
                  await supabase?.auth.signOut()
                  setAuthUser(null)
                  setMfaFactorId('')
                  setMfaCode('')
                  setSignInStep(1)
                  setMode('sign-in')
                }}
                type="button"
              >
                Cancel sign-in
              </button>
            </form>
          </section>
        </div>
      ) : mode === 'reset-password' ? (
        <div className="account-app__login-page">
          <section className="account-app__login-heading" aria-labelledby="form-title">
            <h1 id="form-title">Choose a new password</h1>
            <p>Set a new password for your Cedarline account.</p>
          </section>
          <section className="account-app__login-card" aria-label="Reset your password">
            <form className="account-app__login-form" onSubmit={handleSubmit}>
              {authMessage && <p className="account-app__auth-message" role="alert">{authMessage}</p>}
              <div className="account-app__field">
                <label htmlFor="resetPassword">New password</label>
                <input autoComplete="new-password" id="resetPassword" minLength={12} name="password" placeholder="At least 12 characters" required type="password" />
                <span className="account-app__field-hint">Use at least 12 characters. A unique passphrase is recommended.</span>
              </div>
              <div className="account-app__field">
                <label htmlFor="resetPasswordConfirmation">Confirm new password</label>
                <input autoComplete="new-password" id="resetPasswordConfirmation" minLength={12} name="passwordConfirmation" placeholder="Re-enter your new password" required type="password" />
                <span className="account-app__field-hint">Enter the same password again.</span>
              </div>
              <button className="account-app__login-continue" disabled={authBusy} type="submit">
                {authBusy ? 'Updating password…' : 'Update password'}
              </button>
            </form>
          </section>
        </div>
      ) : (
        <div className="account-app__login-page">
          <section className="account-app__login-heading" aria-labelledby="form-title">
            <h1 id="form-title">{signInStep === 1 ? 'Sign in to your account' : 'Enter your password'}</h1>
            <p>{signInStep === 1 ? 'Log in with your Cedarline email address' : 'Enter your password to continue'}</p>
          </section>

          <section className="account-app__login-card" aria-label="Cedarline sign in">
            <form className="account-app__login-form" onSubmit={handleSubmit}>
              {authMessage && (
                <p className={`account-app__auth-message${authMessageType === 'success' ? ' account-app__auth-message--success' : authMessageType === 'info' ? ' account-app__auth-message--info' : ''}`} role={authMessageType === 'error' ? 'alert' : 'status'}>
                  {authMessage}
                </p>
              )}
              {signInStep === 1 ? (
                <>
                  <div className="account-app__field">
                    <label htmlFor="signInEmail">Email address</label>
                    <input
                      autoComplete="email"
                      defaultValue={signInUsername}
                      id="signInEmail"
                      name="email"
                      onChange={(event) => setSignInUsername(event.target.value)}
                      placeholder="you@example.com"
                      required
                      type="email"
                    />
                  </div>
                  <label className="account-app__checkbox">
                    <input
                      checked={rememberUsername}
                      name="rememberUsername"
                      onChange={(event) => setRememberUsername(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Remember this email</span>
                  </label>
                </>
              ) : (
                <>
                  <div className="account-app__login-identity">
                    <div>
                      <span>Email address</span>
                      <strong>{signInUsername}</strong>
                    </div>
                    <button
                      className="account-app__text-button"
                      onClick={() => {
                        setSignInStep(1)
                        setShowPassword(false)
                      }}
                      type="button"
                    >
                      Change
                    </button>
                  </div>
                  <div className="account-app__field account-app__field--inline-action">
                    <label htmlFor="password">Password</label>
                    <input
                      autoComplete="current-password"
                      autoFocus
                      id="password"
                      name="password"
                      placeholder="Enter your password"
                      required
                      type={showPassword ? 'text' : 'password'}
                    />
                    <button
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="account-app__field-action"
                      onClick={() => setShowPassword(!showPassword)}
                      type="button"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </>
              )}
              <button className="account-app__login-continue" disabled={authBusy} type="submit">
                {authBusy ? 'Signing in…' : signInStep === 1 ? 'Continue' : 'Sign in'}
              </button>
            </form>
          </section>

          <div className="account-app__login-links">
            <p>
              <button className="account-app__text-button" disabled={authBusy} onClick={handleForgotPassword} type="button">
                {authBusy ? 'Sending email…' : 'Forgot password?'}
              </button>
            </p>
            <p>
              Don’t have a Cedarline account?{' '}
              <button className="account-app__text-button" onClick={() => changeMode('create-account')} type="button">Enroll now</button>.
            </p>
          </div>
        </div>
      )}

      <footer className="account-app__footer">
        <nav className="account-app__footer-nav" aria-label="Cedarline information">
          <span>Contact Us</span>
          <span>Terms and Conditions</span>
          <span>Privacy Pledge</span>
          <span>Security</span>
          <span>Notice at Collection</span>
          <span>Online Tracking &amp; Advertising</span>
          <span>Accessible Banking</span>
          <span>Leave Feedback</span>
        </nav>
        <p className="account-app__footer-support">
          Call Cedarline or visit <span>Cedarline Help &amp; Support</span>.
        </p>
        <section className="account-app__disclosure" aria-label="Product disclosures">
          <h2>
            Non-deposit products including investments, securities, mutual funds, insurance products, crypto assets, and annuities:
          </h2>
          <div className="account-app__disclosure-grid">
            <span>Are not FDIC-insured</span>
            <span>Are not bank guaranteed</span>
            <span>May lose value</span>
            <span>Are not deposits</span>
            <span>Are not a condition of any banking activity</span>
            <span>Are not insured by any government entity</span>
          </div>
        </section>
        <div className="account-app__footer-legal">
          <p>©2026 Cedarline. All rights reserved.</p>
          <p>Cedarline, the Cedarline logo and the Cedarline green are Cedarline trademarks.</p>
          <div className="account-app__footer-brand" aria-label="Cedarline">
            <span className="account-app__brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Cedarline</span>
          </div>
        </div>
      </footer>
    </main>
  )
}

export default App
