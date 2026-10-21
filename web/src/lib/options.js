// Choice lists for the job card, taken from the MWL "NewJobSimple" / "NewJobAdvance" mocks.
export const REQUEST_TYPES = [['estimate', 'Estimate'], ['cad', 'CAD'], ['render', 'Render'], ['order', 'Order']];
// Project type maps onto jobs.job_type
export const PROJECT_TYPES = [['custom', 'Custom'], ['catalog_edit', 'Edit'], ['catalog', 'Existing']];
export const SUB_TYPES = [['finish', 'Finish'], ['semi', 'Semi'], ['mount', 'Mount']];
export const REF_TYPES = [['style', 'Style #'], ['sku', 'SKU #'], ['job', 'Job #']];
export const ITEM_TYPES = ['Ring', 'Earring', 'Pendant', 'Necklace', 'Bracelet', 'Bangle', 'Charm', 'Anklet', 'Brooch', 'Chain', 'Set'];
export const ITEM_SUB_TYPES = {
  Ring: ['Solitaire', 'Three Stone', 'Halo', 'Eternity', 'Wedding Band', 'Cluster', 'Toi et Moi', 'Signet'],
  Earring: ['Studs', 'Hoops', 'Drops', 'Huggies', 'Climbers'],
  Pendant: ['Solitaire', 'Halo', 'Cluster', 'Charm'],
  Necklace: ['Tennis', 'Riviera', 'Station', 'Lariat'],
  Bracelet: ['Tennis', 'Bangle', 'Chain', 'Cuff'],
};
export const SIZE_SYSTEMS = ['EU', 'US', 'UK', 'AU', 'IN', 'JP', 'cm', 'mm', 'inch'];
export const QUICK_OPTIONS = ['Wed Fit Required', 'Solid Build Quality', 'Light Weight', 'Budget Friendly', 'Finish', 'Measurements', 'Comfort Fit', 'Profile Type'];
export const METALS = ['18KT YG', '18KT WG', '18KT RG', '14KT YG', '14KT WG', '14KT RG', '10KT YG', '10KT WG', '9KT YG', '9KT WG', 'PT950', 'PD950', 'Silver 925'];
export const METAL_COLORS = ['Yellow', 'White', 'Rose', 'Two Tone', 'Three Tone'];
export const RHODIUM = ['No', 'Yes', 'Partial', 'Black'];
export const FINISHES = ['Polished', 'Matte', 'Brushed', 'Sandblast', 'Hammered'];
export const METAL_TONES = [['single', 'Single'], ['two', 'Two tone'], ['three', 'Three tone']];
export const STONE_TYPES = [['DIA', 'Diamond (mined)'], ['LGD', 'Lab grown'], ['GEM', 'Gemstone']];
export const SHAPES = ['RND', 'OVL', 'PRN', 'EMR', 'CUS', 'RAD', 'PEAR', 'MQS', 'HRT', 'ASC', 'BAG', 'TRL', 'PRS', 'OEC'];
export const SETTINGS = ['Prong', 'Pave', 'Micro Pave', 'Bezel', 'Half Bezel', 'Channel', 'Flush', 'Tension', 'Bar'];
export const SOURCES = [['B', 'Back office'], ['O', 'Office'], ['F', 'Factory'], ['C', 'Customer']];
export const ENGRAVE_METHODS = [['laser', 'Laser'], ['hand', 'Hand'], ['raised', 'Raised (CAD)'], ['recessed', 'Recessed (CAD)']];

export const label = (pairs, v) => (pairs.find((p) => p[0] === v) || [])[1] || v || '—';
