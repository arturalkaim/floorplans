plan "Kitchen extension" walls 0.2/0.1

room kitchen "Kitchen" kitchen rect 0,0 5x4 habitable
outdoor terrace "Terrace" rect 0,4 5x3

door kitchen>terrace w1.8 on:kitchen.south glazed
window kitchen.north w1.5

fixture counter in:kitchen at 0.2,0.2 size 3.5x0.6 depth:0.6 id:counter_run
fixture island in:kitchen at 1.5,2 size 1.2x0.8
