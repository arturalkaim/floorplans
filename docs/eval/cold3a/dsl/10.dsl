plan "Guest house" walls 0.2/0.1

room bed1 "Bedroom 1" bedroom rect 0,0 3.5x2.4 habitable
room shower1 "Shower room 1" bath rect 3.5,0 1.5x2.4 wet
room bed2 "Bedroom 2" bedroom rect 5,0 3.5x2.4 habitable
room shower2 "Shower room 2" bath rect 8.5,0 1.5x2.4 wet
room corridor "Corridor" corridor rect 0,2.4 10x1.2 circulation
room bed3 "Bedroom 3" bedroom rect 0,3.6 3.5x2.4 habitable
room shower3 "Shower room 3" bath rect 3.5,3.6 1.5x2.4 wet
room bed4 "Bedroom 4" bedroom rect 5,3.6 3.5x2.4 habitable
room shower4 "Shower room 4" bath rect 8.5,3.6 1.5x2.4 wet

door corridor.west w0.9 entrance
door corridor>bed1 at 1.75,2.4 w0.8
door corridor>bed2 at 6.75,2.4 w0.8
door corridor>bed3 at 1.75,3.6 w0.8
door corridor>bed4 at 6.75,3.6 w0.8
door bed1>shower1 at 3.5,1.2 w0.7
door bed2>shower2 at 8.5,1.2 w0.7
door bed3>shower3 at 3.5,4.8 w0.7
door bed4>shower4 at 8.5,4.8 w0.7
window bed1.north w1.2
window bed2.north w1.2
window bed3.south w1.2
window bed4.south w1.2
