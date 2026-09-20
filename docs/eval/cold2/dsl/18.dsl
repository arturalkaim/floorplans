plan "Shop"

room shopfloor "Shop Floor" shop rect 0,0 6x5
room storeroom "Storeroom" storage rect 6,0 3x3
room staffwc "Staff WC" wc rect 6,3 3x2

door shopfloor.north w1.8 entrance
door shopfloor>storeroom w0.9 hinge:start swing:storeroom
door storeroom>staffwc w0.7 hinge:end swing:staffwc
