'use client'
// Which restaurant am I editing, and what am I allowed to do in it?
//
// Ported from the platform's hook of the same name, keeping its exported shape exactly:
// seven screens and the sidebar read sixteen fields off this, and changing the shape would
// mean touching all of them to port one thing.
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
// build if one appears. Every capability returns true.
//
// The SHAPE stays, though, and that is the point of doing it this way rather than ripping
// the flags out of seven screens. When pricing exists, it is this file that learns about
// it and nothing else.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type PlanId = 'creator' | 'basic300' | 'full450' | 'premium900'
export type PlatformPlanId = 'ar_menu' | 'full' | 'premium'
export type RoleId = 'super_admin' | 'brand_owner' | 'branch_manager' | 'branch_staff'

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
  /** A uuid now, not a number. Typed as string, and every consumer only ever passes it
   *  back to a query - none of them do arithmetic on it. */
  restaurantId: string | null
  restaurantSlug: string
  restaurantName: string
  restaurantDomain: string
  canCreateBranchesEntitlement: boolean
  hasTenantContext: boolean
  /** Every restaurant this account can reach, for the picker in the sidebar. */
  tenants: { id: string; slug: string; name: string }[]
}

const EMPTY: PlanAccess = {
  role: 'brand_owner',
  plan: 'creator',
  platformPlan: 'premium',
  loading: true,
  canUseMenu: true,
  canUseAnalytics: true,
  canUseTheme: true,
  canUseDeveloperAnalytics: true,
  canUploadModels: true,
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
}

export function usePlan(): PlanAccess {
  const params = useSearchParams()
  const wanted = params.get('tenant') || ''
  const [access, setAccess] = useState<PlanAccess>(EMPTY)

  useEffect(() => {
    let alive = true
    const supabase = createClient()

    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth?.user) {
        if (alive) setAccess({ ...EMPTY, loading: false })
        return
      }

      // Unfiltered on purpose. `is_member_of` in the database decides what comes back, so
      // a super admin sees every restaurant and an owner sees theirs, with no branch here
      // that could disagree with the policy.
      const { data: rows } = await supabase
        .from('tenants')
        .select('id, slug, name, settings')
        .order('name')

      const tenants = (rows || []).map(r => ({ id: r.id, slug: r.slug, name: r.name }))

      // ?tenant=<slug> wins, so a link to one restaurant opens that restaurant - the
      // platform's URLs work the same way and people have them bookmarked.
      const current = rows?.find(r => r.slug === wanted) ?? rows?.[0] ?? null

      const { data: superRow } = await supabase
        .from('super_admins').select('user_id').maybeSingle()
      const isSuper = !!superRow

      if (!alive) return
      setAccess({
        ...EMPTY,
        loading: false,
        role: isSuper ? 'super_admin' : 'brand_owner',
        label: isSuper ? 'BetaReal' : '',
        canManageTenants: isSuper,
        restaurantId: current?.id ?? null,
        restaurantSlug: current?.slug ?? '',
        restaurantName: current?.name ?? '',
        restaurantDomain:
          (current?.settings as Record<string, string> | null)?.custom_domain ?? '',
        hasTenantContext: !!current,
        tenants,
      })
    })()

    return () => { alive = false }
  }, [wanted])

  return access
}

export default usePlan
