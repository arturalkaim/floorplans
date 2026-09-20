plan "Flat on a grid" walls 0.2/0.1

room living "Living room" living habitable
room bed1 "Bedroom 1" bedroom habitable
room bed2 "Bedroom 2" bedroom habitable
room bath "Bathroom" bath wet

layout cols 3,3,2.5,2.5 rows 3,3
  living living bed1 bed1
  living living bed2 bath

door living.south w1.0 entrance
door living>bed1 at 6,1.5 w0.8
door living>bed2 at 6,4.5 w0.8
door bed1>bath at 9.75,3 w0.7
door bed2>bath at 8.5,4.5 w0.7
window bed1.north w1.2
window bed2.south w1.2
window bath.south w0.6
