plan "Courtyard house" walls 0.2/0.1

room living "Living room" living rect 2,0 3x2
room kitchen "Kitchen" kitchen rect 0,2 2x3
room bath "Bathroom" bath rect 5,2 2x3
room bedroom "Bedroom" bedroom rect 2,5 3x2
outdoor courtyard "Courtyard" rect 2,2 3x3

door living.north w0.9 entrance
door courtyard>living @1 w1.2
door courtyard>kitchen @1 w0.9
door courtyard>bath @1 w0.7
door courtyard>bedroom @1 w0.9

window living.north w1.5
window kitchen.west w1
window bath.east w0.6
window bedroom.south w1.5
