import test from 'node:test'
import assert from 'node:assert/strict'
import { removeRestaurantWith } from './removeRestaurant.js'
const row = { tenant_id: 'restaurant-id', slug: 'corner' }
test('wrong confirmation never sends a deletion', async () => {
  await assert.rejects(removeRestaurantWith({ rpc() { assert.fail('must not call') } }, row, 'Corner'), /exact/)
})
test('sends immutable id and exact slug, returns confirmed deletion only', async () => {
  const client = { async rpc(name, args) {
    assert.equal(name, 'remove_tenant')
    assert.deepEqual(args, { p_tenant: row.tenant_id, p_slug: row.slug })
    return { data: row.tenant_id, error: null }
  } }
  assert.equal(await removeRestaurantWith(client, row, 'corner'), row.tenant_id)
})
test('permission, shared-model and engine failures are surfaced', async () => {
  for (const message of ['permission denied', 'shared models', 'active engine work']) {
    await assert.rejects(removeRestaurantWith({ async rpc() { return { error: { message } } } }, row, 'corner'), { message })
  }
})
test('missing or wrong success response cannot remove a UI row', async () => {
  for (const data of [null, 'other-id']) {
    await assert.rejects(removeRestaurantWith({ async rpc() { return { data, error: null } } }, row, 'corner'), /not confirmed/)
  }
})
