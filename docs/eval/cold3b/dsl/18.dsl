plan "Shop" walls 0.2/0.1

room shop "Shop floor" other rect 0,0 6x4
room storeroom "Storeroom" storage rect 0,4 4x2
room staffwc "Staff WC" wc rect 4,4 2x2

door shop.north w1.8 entrance id:frontdoor
door shop>storeroom @1 w0.9
door storeroom>staffwc @0.3 w0.7

window shop.north w2
window storeroom.west w1
