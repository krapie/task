// Shown when a guest reaches a feature that needs an account (e.g. via a ?tab= deep link)
export function SignInRequired({ feature, onSignIn }: { feature: string; onSignIn: () => void }) {
  return (
    <div className="signin-required">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
      <p className="signin-required-title">Sign in to use {feature}</p>
      <p className="signin-required-sub">{feature} syncs with your account and isn't available in guest mode.</p>
      <button className="btn-primary" onClick={onSignIn}>Sign in</button>
    </div>
  )
}
