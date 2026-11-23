// Which guest saved which property (the "heart" on a listing card).
export type SavedProperty = { guest_id: string; property_id: string }

export const seedSaved: SavedProperty[] = [
  { guest_id: 'g_001', property_id: 'p_001' },
  { guest_id: 'g_001', property_id: 'p_005' },
  { guest_id: 'g_001', property_id: 'p_018' },
  { guest_id: 'g_002', property_id: 'p_005' },
  { guest_id: 'g_002', property_id: 'p_023' },
  { guest_id: 'g_003', property_id: 'p_014' },
  { guest_id: 'g_006', property_id: 'p_022' },
  { guest_id: 'g_006', property_id: 'p_024' },
  { guest_id: 'g_006', property_id: 'p_030' },
  { guest_id: 'g_009', property_id: 'p_010' },
]
