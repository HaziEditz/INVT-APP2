package com.khybertech.taxi360driver.Settings;

import android.content.Context;
import android.graphics.Color;
import android.support.annotation.NonNull;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.TextView;

import com.khybertech.taxi360driver.R;

import java.util.List;

/**
 * Created by AK on 13/12/2016.
 */

public class CustomAdapterSettings extends ArrayAdapter<Model> {
    Context ctx;
    List<Model> ls;
    public CustomAdapterSettings(Context context, List<Model> ls) {
        super(context, R.layout.row_list_details,ls);
        ctx = context;
        this.ls = ls;
    }

    @NonNull
    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        LayoutInflater infl = (LayoutInflater) ctx.getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        if (convertView == null){
            convertView = infl.inflate(R.layout.row_list_details,null);
        }
        TextView tx = (TextView) convertView.findViewById(R.id.txt_key_list_details);
        TextView tx_value = (TextView) convertView.findViewById(R.id.txt_value_list_details);

        tx.setText(ls.get(position).getTitle());
        if (ls.get(position).getValue().equalsIgnoreCase("1")){
            tx_value.setText(ls.get(position).getValue());
            tx_value.setTextColor(Color.parseColor("#88a903"));
        }
        else if (ls.get(position).getValue().equalsIgnoreCase("0")){
            tx_value.setText(ls.get(position).getValue());
            tx_value.setTextColor(Color.parseColor("#e8692b"));
        }
        else {
            tx_value.setText(ls.get(position).getValue());
        }
        return convertView;
    }
}
