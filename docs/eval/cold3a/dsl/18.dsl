plan "Shop" walls 0.2/0.1

room shopfloor "Shop floor" other rect 0,0 6x4 habitable
room storeroom "Storeroom" storage rect 0,4 4x2
room wc "Staff WC" wc rect 4,4 2x2 wet

door shopfloor.north w1.5 entrance
door shopfloor>storeroom at 2,4 w1.0
door shopfloor>wc at 5,4 w0.7
window shopfloor.north @3.5 w2
window wc.east w0.5
