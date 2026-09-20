plan "Guest house" walls 0.2/0.1

room bedroom1 "Bedroom 1" bedroom rect 0,0 2x4
room ensuite1 "Ensuite 1" bath rect 2,0 1x4
room bedroom2 "Bedroom 2" bedroom rect 3,0 2x4
room ensuite2 "Ensuite 2" bath rect 5,0 1x4
room bedroom3 "Bedroom 3" bedroom rect 6,0 2x4
room ensuite3 "Ensuite 3" bath rect 8,0 1x4
room bedroom4 "Bedroom 4" bedroom rect 9,0 2x4
room ensuite4 "Ensuite 4" bath rect 11,0 1x4
room corridor "Corridor" corridor rect 0,4 12x1.2

door corridor.south w0.9 entrance
door corridor>bedroom1 @1 w0.8
door corridor>ensuite1 @0.3 w0.7
door corridor>bedroom2 @1 w0.8
door corridor>ensuite2 @0.3 w0.7
door corridor>bedroom3 @1 w0.8
door corridor>ensuite3 @0.3 w0.7
door corridor>bedroom4 @1 w0.8
door corridor>ensuite4 @0.3 w0.7

window bedroom1.north w1.2
window bedroom2.north w1.2
window bedroom3.north w1.2
window bedroom4.north w1.2
window ensuite1.north w0.5
window ensuite2.north w0.5
window ensuite3.north w0.5
window ensuite4.north w0.5
