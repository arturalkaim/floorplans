plan "Flat on a grid" walls 0.2/0.1
grid cols 3,3 rows 3,3

room living "Living room" living
room kitchen "Kitchen" kitchen
room bedroom "Bedroom" bedroom
room bath "Bathroom" bath

layout
  living kitchen
  bedroom bath

door living>kitchen @1 w0.9
door living>bedroom @1 w0.9
door bedroom>bath @0.5 w0.7
door living.west w0.9 entrance

window living.north w1.5
window kitchen.north w1
window bedroom.west w1.2
window bath.east w0.6
