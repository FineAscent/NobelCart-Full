const test = require('node:test');
const assert = require('node:assert/strict');
const { groupMatches } = require('../../product-search.js');

const products = [
  { id: '1', name: 'Pork ribs', category: 'Meats', barcode: '123456' },
  { id: '2', name: 'Ribs sauce', category: 'Pantry' },
  { id: '3', name: 'Beef ribs', category: 'Meats' },
  { id: '4', name: 'Red apples', category: 'Produce' },
  { id: '5', name: 'Ribbs seasoning', category: 'Pantry' }
];

test('current category comes before a stronger match in another category', () => {
  const groups = groupMatches(products, 'ribbs', ' meats ');
  assert.deepEqual(groups.map(g => g.category), ['Meats', 'Pantry']);
  assert.deepEqual(groups[0].matches.map(m => m.product.id), ['3', '1']);
  assert.equal(groups[1].matches[0].product.id, '5');
});

test('cabinet groups by relevance without a selected category', () => {
  assert.equal(groupMatches(products, 'ribbs')[0].category, 'Pantry');
});

test('accepts inserted or swapped letters and multiple query words', () => {
  assert.equal(groupMatches(products, 'pork ribbs')[0].matches[0].product.id, '1');
  assert.equal(groupMatches(products, 'beef risb')[0].matches[0].product.id, '3');
  assert.deepEqual(groupMatches(products, 'pork apples'), []);
});

test('exact and partial barcodes work without fuzzy number matches', () => {
  assert.equal(groupMatches(products, '123456')[0].matches[0].product.id, '1');
  assert.equal(groupMatches(products, '3456')[0].matches[0].product.id, '1');
  assert.deepEqual(groupMatches(products, '123457'), []);
});

test('empty queries and unrelated words do not match; names normalize accents', () => {
  assert.deepEqual(groupMatches(products, '  '), []);
  assert.deepEqual(groupMatches(products, 'detergent'), []);
  assert.equal(groupMatches([{ name: 'Crème fraîche', category: 'Dairy' }], 'creme')[0].category, 'Dairy');
});

test('merges category casing, removes duplicate products, and labels missing categories', () => {
  const groups = groupMatches([
    { id: 1, name: 'Ribs', category: 'Meats' },
    { id: 1, name: 'Ribs', category: ' meats ' },
    { id: 2, name: 'Ribs', category: 'meats' },
    { id: 3, name: 'Ribs' }
  ], 'ribs');
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.key === 'meats').matches.length, 2);
  assert.equal(groups.find(g => g.category === 'Other').matches.length, 1);
});
