plan "Courtyard house" walls 0.2/0.1

room living "Living room" living poly 0,0 4,0 4,3 3,3 3,4 0,4 habitable
room kitchen "Kitchen" kitchen poly 4,0 8,0 8,4 5,4 5,3 4,3 habitable
room bedroom "Bedroom" bedroom poly 5,4 8,4 8,8 4,8 4,5 5,5 habitable
room bath "Bathroom" bath poly 0,4 3,4 3,5 4,5 4,8 0,8 wet
outdoor courtyard "Courtyard" rect 3,3 2x2

door living.north w1.0 entrance
door living>courtyard at 3,3.5 w0.8
door kitchen>courtyard at 4,3.5 w0.8
door bedroom>courtyard at 4.5,4 w0.8
door bath>courtyard at 4,4.5 w0.7
window kitchen.east w1.2
window bedroom.south w1.2
