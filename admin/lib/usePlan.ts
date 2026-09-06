'use client'
// Which restaurant am I editing, and what am I allowed to do in it?
//
// Ported from the platform's hook of the same name, keeping its exported shape exactly:
// every screen and the sidebar read these fields, and changing the shape would mean
// touching all of them to port one thing.
//
// What changed underneath is everything:
//
//   restaurants + brands + restaurant_users  ->  tenants + tenant_members + super_admins
//   numeric restaurant_id                    ->  uuid
//   a `plan` column deciding features        ->  nothing. See below.
//
// **The plan tiers are gone, deliberately.** The platform gates menu, analytics, theme and
// model upload behind creator/basic300/full450/premium900. DECISIONS §9.3: pricing is not
// decided, so no column in our schema may pretend it is - `check_schema.py` fails the
// build if one appears. The SHAPE stays, so when pricing exists this is the only file that
// learns about it.
//
// ── why this is a context and not three queries per screen ────────────────────────────
//
// It used to run `auth.getUser()`, then the tenants query, then super_admins - one after
// another, inside every page, on every navigation. Measured against the real project from
// Tbilisi: about 470 ms each, so roughly 1.4 SECONDS of waterfall before a screen could
// begin its own queries, repeated every time somebody clicked a link. That was the whole
// of "it takes a lot of time to load", and it was invisible from the code because each
// screen only looked like it called one hook.
//
// Now it resolves ONCE, at the shell, with the three calls fired together, and every
// screen reads the answer out of context. First paint costs one round trip instead of
// three; every navigation after that costs none.

import { createContext, createElement, useContext, useEffect, useMemo, useState,
         type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type PlanId = 'creator' | 'basic300' | 'full450' | 'premium900'
export type PlatformPlanId = 'ar_menu' | 'full' | 'premium'
export type RoleId = 'super_admin' | 'brand_owner' | 'branch_manager' | 'branch_staff'

export type Tenant = { id: string; slug: string; name: string; settings?: Record<string, string> }

export type PlanAccess = {
  role: RoleId
  plan: PlanId
  platformPlan: PlatformPlanId
  loading: boolean
  canUseMenu: boolean
  canUseAnalytics: boolean
  canUseTheme: boolean
  canUseDeveloperAnalytics: boolean
  canUploadModels: boolean
  canManageTenants: boolean
  canManageBranches: boolean
  canCreateBranches: boolean
  itemLimit: number | null
  label: string
  brandId: number | null
  /** A uuid now, not a number. Typed as string; no consumer does arithmetic on it. */
  restaurantId: string | null
  restaurantSlug: string
  restaurantName: string
  restaurantDomain: string
  canCreateBranchesEntitlement: boolean
  hasTenantContext: boolean
  /** Every restaurant this account can reach, for the picker in the sidebar. */
  tenants: Tenant[]
  /** Who is signed in - for the account screen, and for saying so out loud. */
  email: string
  userId: string | null
}

const EMPTY: PlanAccess = {
  role: 'brand_owner',
  plan: 'creator',
  platformPlan: 'premium',
  loading: true,
  canUseMenu: true,
  canUseAnalytics: true,
  canUseTheme: true,
  canUseDeveloperAnalytics: false,
  // What the server enforces: models and hero videos are ours to upload (api/asset).
  // A flag that said otherwise would put a control in front of an owner that refuses them.
  canUploadModels: false,
  canManageTenants: false,
  canManageBranches: false,
  canCreateBranches: false,
  itemLimit: null,
  label: '',
  brandId: null,
  restaurantId: null,
  restaurantSlug: '',
  restaurantName: '',
  restaurantDomain: '',
  canCreateBranchesEntitlement: false,
  hasTenantContext: false,
  tenants: [],
  email: '',
  userId: null,
}

/** What is true about the ACCOUNT - resolved once, and not again while the tab lives. */
type Account = {
  ready: boolean
  userId: string | null
  email: string
  isSuper: boolean
  tenants: Tenant[]
}

const AccountContext = createContext<Account>({
  ready: false, userId: null, email: '', isSuper: false, tenants: [],
})

export function PlanProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>({
    ready: false, userId: null, email: '', isSuper: false, tenants: [],
  })

  useEffect(() => {
    let alive = true
    const supabase = createClient()

    ;(async () => {
      // All three together. They do not depend on each other: the two table reads carry
      // the session cookie and RLS answers them, so waiting for getUser() first bought
      // nothing but a round trip.
      const [auth, rows, superRow] = await Promise.all([
        supabase.auth.getUser(),
        // Unfiltered on purpose. `is_member_of` in the database decides what comes back,
        // so a super admin sees every restaurant and an owner sees theirs, with no branch
        // here that could disagree with the policy.
        supabase.from('tenants').select('id, slug, name, settings').order('name'),
        // `limit(1)`, not a bare maybeSingle: a super admin can SEE every row in this
        // table, so with two of us maybeSingle would error on "multiple rows".
        supabase.from('super_admins').select('user_id').limit(1).maybeSingle(),
      ])
      if (!alive) return
      setAccount({
        ready: true,
        userId: auth.data?.user?.id ?? null,
        email: auth.data?.user?.email ?? '',
        isSuper: !!superRow.data,
        tenants: (rows.data as Tenant[]) || [],
      })
    })()

    return () => { alive = false }
  }, [])

  return createElement(AccountContext.Provider, { value: account }, children)
}

export function usePlan(): PlanAccess {
  const account = useContext(AccountContext)
  const params = useSearchParams()
  // ?tenant=<slug> wins, so a link to one restaurant opens that restaurant - the
  // platform's URLs work the same way and people have them bookmarked.
  const wanted = params.get('tenant') || ''

  return useMemo(() => {
    if (!account.ready) return EMPTY
    const current = account.tenants.find(t => t.slug === wanted) ?? account.tenants[0] ?? null
    return {
      ...EMPTY,
      loading: false,
      role: account.isSuper ? 'super_admin' : 'brand_owner',
      label: account.isSuper ? 'BetaReal' : '',
      canManageTenants: account.isSuper,
      canUseDeveloperAnalytics: account.isSuper,
      canUploadModels: account.isSuper,
      restaurantId: current?.id ?? null,
      restaurantSlug: current?.slug ?? '',
      restaurantName: current?.name ?? '',
      restaurantDomain: current?.settings?.custom_domain ?? '',
      hasTenantContext: !!current,
      tenants: account.tenants,
      email: account.email,
      userId: account.userId,
    }
  }, [account, wanted])
}

export default usePlan
