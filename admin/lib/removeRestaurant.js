/** UUID + exact current slug are checked again by the super-admin-only database RPC. */
export async function removeRestaurantWith(client, row, confirmation) {
  if (confirmation !== row.slug) throw new Error('Type the exact restaurant address to confirm.')
  const { data, error } = await client.rpc('remove_tenant', {
    p_tenant: row.tenant_id, p_slug: confirmation,
  })
  if (error) throw new Error(error.message || 'Restaurant could not be removed.')
  if (data !== row.tenant_id) throw new Error('Removal was not confirmed. Refresh the directory before retrying.')
  return data
}
