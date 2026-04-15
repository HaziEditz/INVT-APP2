package com.khybertech.taxi360driver.ShiftHistory;

import android.content.Context;
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

public class CustomAdapterShiftHistory extends ArrayAdapter<ModelShiftHistory> {

    List<ModelShiftHistory> ls_data;
    Context ctx;

    public CustomAdapterShiftHistory(Context context, List<ModelShiftHistory> ls) {
        super(context, R.layout.row_shifthistory,ls);
        ctx = context;
        ls_data = ls;
    }

    @NonNull
    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        LayoutInflater infl = (LayoutInflater) ctx.getSystemService(Context.LAYOUT_INFLATER_SERVICE);
        if (convertView == null){
            convertView = infl.inflate(R.layout.row_shifthistory,null);
        }
        TextView date = (TextView) convertView.findViewById(R.id.txt_list_shifthistory_date);
        TextView startTime = (TextView) convertView.findViewById(R.id.txt_list_shifthistory_starttime);
        TextView endTime = (TextView) convertView.findViewById(R.id.txt_list_shifthistory_endtime);

        date.setText(ls_data.get(position).getDate());
        startTime.setText(ls_data.get(position).getStartTime());
        endTime.setText(ls_data.get(position).getEndTime());
        return convertView;
    }
}
