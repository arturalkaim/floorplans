plan "Cottage with a porch" walls 0.2/0.1

room living "Living room" living rect 0,0 2x3.5 habitable
room bedroom "Bedroom" bedroom rect 2,0 2x3.5 habitable
room kitchen "Kitchen" kitchen rect 4,0 2x3.5 habitable
outdoor porch "Porch" covered rect 0,3.5 6x1.5

door porch>living w0.9 on:living.south entrance
door living>bedroom at 2,1.75 w0.8
door bedroom>kitchen at 4,1.75 w0.8
window bedroom.north w1.2
window kitchen.north w1.2
